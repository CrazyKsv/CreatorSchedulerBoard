"""/api/v1/agent — Kimi (Moonshot) powered scheduling assistant.

The frontend SchedulerAgent (⌘K overlay) used to fabricate a plan in
JavaScript. This endpoint replaces that with a real LLM loop:

  1. Front-end posts {message, history?} to /api/v1/agent/chat
  2. We hand the message to Moonshot's OpenAI-compatible chat-completion
     API together with a tool catalog (create_series, create_post,
     query_upcoming_posts, list_series).
  3. The model responds either with a final assistant message OR with
     tool calls. We execute each tool against the authenticated user's
     data via the existing services, append the tool result, and
     re-prompt the model — up to MAX_ITERS times — until it returns a
     final answer.
  4. The endpoint returns the final assistant text plus a structured
     `actions` log (so the UI can show "✓ Created series #5").

We deliberately use the existing service-layer functions (check
gap, atomic series insert) so the agent is held to the same
invariants (15-min same-platform gap, future-only times, sequential
integrity) as a human user.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from typing import Annotated, Any, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user_id
from app.core.config import settings
from app.core.database import get_db
from app.core.scheduling import (
    GAP,
    check_platform_gap,
    check_sequential_integrity,
    is_past_est,
)
from app.models.post import Post
from app.models.series import Series

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agent", tags=["agent"])

# ─── Moonshot config ──────────────────────────────────────────
# Read from pydantic-settings (which loads backend/.env). Never hard-
# code an API key in source. Override via env: MOONSHOT_API_KEY,
# MOONSHOT_BASE, MOONSHOT_MODEL.

MAX_ITERS = 6
STAGE_LABELS = ["Teaser", "Announcement", "Follow-up", "Reminder"]
DEFAULT_PLATFORM = "instagram"


# ─── Request / response models ────────────────────────────────
class ChatMessage(BaseModel):
    role: str
    content: Optional[str] = None


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    # Optional client-side conversation history. We don't persist it.
    history: list[ChatMessage] = Field(default_factory=list)


class AgentAction(BaseModel):
    type: str
    summary: str
    data: dict[str, Any] = Field(default_factory=dict)


class ChatResponse(BaseModel):
    reply: str
    actions: list[AgentAction]
    used_tools: list[str]


# ─── Tool catalog (OpenAI / Moonshot tool-calling shape) ──────
TOOL_CATALOG: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "create_series",
            "description": (
                "Create a 4-stage content series (Teaser, Announcement, "
                "Follow-up, Reminder). Provide a teaser start date/time; "
                "remaining stages auto-populate at +1 day each unless "
                "explicit per-stage times are supplied. All times must be "
                "in the future and ISO 8601 (no timezone = local naive "
                "interpreted as EST)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Series title"},
                    "description": {"type": "string"},
                    "platform": {
                        "type": "string",
                        "enum": ["youtube", "instagram", "twitter", "tiktok", "linkedin"],
                        "description": "Single platform for all 4 stages.",
                    },
                    "start_at": {
                        "type": "string",
                        "description": "ISO datetime for the Teaser stage (e.g. 2026-05-20T13:00:00).",
                    },
                    "stage_times": {
                        "type": "array",
                        "description": (
                            "Optional explicit ISO datetimes for all 4 "
                            "stages [Teaser, Announcement, Follow-up, "
                            "Reminder]. If omitted, stages are spaced +1 "
                            "day from start_at."
                        ),
                        "items": {"type": "string"},
                    },
                    "stage_titles": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional 4 per-stage post titles.",
                    },
                    "stage_bodies": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional 4 per-stage post bodies.",
                    },
                    "source_series_id": {
                        "type": "integer",
                        "description": (
                            "Optional id of an existing series this new one "
                            "is a cross-platform sibling of. When creating "
                            "the same narrative series on multiple platforms, "
                            "call create_series for the FIRST platform with "
                            "no source_series_id, then for EACH additional "
                            "platform pass source_series_id = <id of the "
                            "first series>. This links them into one family "
                            "so the UI groups them together under a single "
                            "card with per-platform tabs. Omit for a fresh, "
                            "unrelated series."
                        ),
                    },
                },
                "required": ["title", "platform", "start_at"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_post",
            "description": "Create a single standalone scheduled post.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "platform": {
                        "type": "string",
                        "enum": ["youtube", "instagram", "twitter", "tiktok", "linkedin"],
                    },
                    "scheduled_at": {
                        "type": "string",
                        "description": "ISO datetime in the future.",
                    },
                    "body": {"type": "string"},
                    "status": {
                        "type": "string",
                        "enum": ["draft", "scheduled"],
                        "description": "Default scheduled.",
                    },
                },
                "required": ["title", "platform", "scheduled_at"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "query_upcoming_posts",
            "description": (
                "Count and list upcoming posts in a time range. Use this "
                "to answer 'how many posts do I have this week / next 3 "
                "days / between X and Y'. Dates are ISO. If omitted, "
                "defaults to the next 7 days from now."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "start": {"type": "string"},
                    "end": {"type": "string"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_series",
            "description": "List the user's active series (id, title, platform, start, post count).",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]


# ─── Tool implementations ─────────────────────────────────────
def _parse_iso(value: str) -> datetime:
    # Accept "Z" suffix and naive forms. We strip TZ so we slot into
    # the existing naive-EST storage convention used everywhere else.
    s = value.strip()
    if s.endswith("Z"):
        s = s[:-1]
    if "+" in s[10:]:  # strip timezone offset like 2026-05-20T13:00:00+00:00
        s = s.split("+", 1)[0]
    return datetime.fromisoformat(s).replace(tzinfo=None)


async def _tool_create_series(
    db: AsyncSession, user_id: int, args: dict[str, Any]
) -> dict[str, Any]:
    title = args.get("title", "Untitled Series")
    description = args.get("description") or ""
    platform = args.get("platform", DEFAULT_PLATFORM)
    start_at_raw = args.get("start_at")
    if not start_at_raw:
        return {"ok": False, "error": "start_at is required"}
    try:
        start_at = _parse_iso(start_at_raw)
    except ValueError as e:
        return {"ok": False, "error": f"invalid start_at: {e}"}

    # Build stage times.
    stage_times_raw = args.get("stage_times") or []
    if stage_times_raw and len(stage_times_raw) == 4:
        try:
            times = [_parse_iso(t) for t in stage_times_raw]
        except ValueError as e:
            return {"ok": False, "error": f"invalid stage_times: {e}"}
    else:
        times = [start_at + timedelta(days=i) for i in range(4)]

    # Future-time check (mirror the series create endpoint).
    for i, t in enumerate(times):
        if is_past_est(t):
            return {
                "ok": False,
                "error": f"stage {i + 1} ({STAGE_LABELS[i]}) is in the past — pick a future time",
            }

    # Sequential Integrity (strict ascending).
    seq = check_sequential_integrity(times)
    if seq is not None:
        return {"ok": False, "error": seq.human_message}

    # 15-min platform gap vs. existing posts.
    for i, t in enumerate(times):
        conflict = await check_platform_gap(
            db, owner_id=user_id, platform=platform, scheduled_at=t
        )
        if conflict is not None:
            return {
                "ok": False,
                "error": (
                    f"stage {i + 1} ({STAGE_LABELS[i]}) at {t.isoformat()} "
                    f"is within 15 min of existing post #{conflict.other_post_id} "
                    f"({conflict.other_scheduled_at.isoformat()})"
                ),
            }

    # Pairwise sibling check (will fail if the agent picked overlapping times).
    for i in range(4):
        for j in range(i + 1, 4):
            if abs((times[j] - times[i]).total_seconds()) < GAP.total_seconds():
                return {
                    "ok": False,
                    "error": f"stages {i + 1} and {j + 1} are within 15 min of each other on {platform}",
                }

    titles = args.get("stage_titles") or [
        f"{title} — {STAGE_LABELS[i]}" for i in range(4)
    ]
    if len(titles) != 4:
        titles = [f"{title} — {STAGE_LABELS[i]}" for i in range(4)]
    bodies = args.get("stage_bodies") or [
        f"{STAGE_LABELS[i]} for {title}." for i in range(4)
    ]
    if len(bodies) != 4:
        bodies = [f"{STAGE_LABELS[i]} for {title}." for i in range(4)]

    # Optional cross-platform linkage. When the LLM is creating the same
    # narrative series on N platforms, it creates the first one without
    # source_series_id then passes source_series_id on subsequent calls so
    # all siblings share a family_id and collapse into one card on the UI.
    source_family_id: Optional[int] = None
    source_series_id_raw = args.get("source_series_id")
    if source_series_id_raw is not None:
        try:
            src_id = int(source_series_id_raw)
        except (TypeError, ValueError):
            return {"ok": False, "error": f"invalid source_series_id: {source_series_id_raw!r}"}
        src_row = await db.execute(
            select(Series).where(Series.id == src_id, Series.owner_id == user_id)
        )
        src = src_row.scalar_one_or_none()
        if src is None:
            return {
                "ok": False,
                "error": (
                    f"source_series_id={src_id} not found or not owned by "
                    "the current user"
                ),
            }
        source_family_id = src.family_id or src.id

    series = Series(
        title=title,
        description=description,
        platform=platform,
        start_at=times[0],
        cadence_unit="days",
        cadence_interval=1,
        post_count=4,
        owner_id=user_id,
        status="active",
    )
    db.add(series)
    await db.flush()
    # Fresh series: self-reference (own family anchor). Sibling: inherit the
    # source's family so the UI groups them under one card.
    series.family_id = source_family_id if source_family_id is not None else series.id

    for i in range(4):
        db.add(
            Post(
                title=titles[i],
                platform=platform,
                scheduled_at=times[i],
                status="scheduled",
                body=bodies[i],
                stage=STAGE_LABELS[i],
                owner_id=user_id,
                series_id=series.id,
                series_position=i,
            )
        )
    await db.commit()
    return {
        "ok": True,
        "series_id": series.id,
        "title": series.title,
        "platform": series.platform,
        "stages": [
            {"stage": STAGE_LABELS[i], "scheduled_at": times[i].isoformat(), "title": titles[i]}
            for i in range(4)
        ],
    }


async def _tool_create_post(
    db: AsyncSession, user_id: int, args: dict[str, Any]
) -> dict[str, Any]:
    title = args.get("title")
    platform = args.get("platform")
    scheduled_at_raw = args.get("scheduled_at")
    body = args.get("body") or ""
    pstatus = args.get("status") or "scheduled"
    if not (title and platform and scheduled_at_raw):
        return {"ok": False, "error": "title, platform, scheduled_at all required"}
    try:
        scheduled_at = _parse_iso(scheduled_at_raw)
    except ValueError as e:
        return {"ok": False, "error": f"invalid scheduled_at: {e}"}
    if is_past_est(scheduled_at):
        return {"ok": False, "error": "scheduled_at must be in the future (EST)"}
    conflict = await check_platform_gap(
        db, owner_id=user_id, platform=platform, scheduled_at=scheduled_at
    )
    if conflict is not None:
        return {
            "ok": False,
            "error": (
                f"within 15 min of post #{conflict.other_post_id} "
                f"at {conflict.other_scheduled_at.isoformat()}"
            ),
        }
    post = Post(
        title=title,
        platform=platform,
        scheduled_at=scheduled_at,
        status=pstatus,
        body=body,
        owner_id=user_id,
    )
    db.add(post)
    await db.commit()
    return {
        "ok": True,
        "post_id": post.id,
        "title": post.title,
        "platform": post.platform,
        "scheduled_at": post.scheduled_at.isoformat(),
        "status": post.status,
    }


async def _tool_query_upcoming(
    db: AsyncSession, user_id: int, args: dict[str, Any]
) -> dict[str, Any]:
    now = datetime.utcnow()
    try:
        s = _parse_iso(args["start"]) if args.get("start") else now
        e = _parse_iso(args["end"]) if args.get("end") else (now + timedelta(days=7))
    except ValueError as exc:
        return {"ok": False, "error": f"invalid date: {exc}"}
    q = await db.execute(
        select(Post).where(
            Post.owner_id == user_id,
            Post.status != "archived",
            Post.scheduled_at.is_not(None),
            Post.scheduled_at >= s,
            Post.scheduled_at <= e,
        ).order_by(Post.scheduled_at.asc())
    )
    items = list(q.scalars().all())
    by_pl: dict[str, int] = {}
    for p in items:
        by_pl[p.platform] = by_pl.get(p.platform, 0) + 1
    return {
        "ok": True,
        "range": {"start": s.isoformat(), "end": e.isoformat()},
        "count": len(items),
        "by_platform": by_pl,
        "items": [
            {
                "id": p.id,
                "title": p.title,
                "platform": p.platform,
                "scheduled_at": p.scheduled_at.isoformat(),
                "status": p.status,
            }
            for p in items[:25]  # cap so the prompt doesn't explode
        ],
    }


async def _tool_list_series(db: AsyncSession, user_id: int, args: dict[str, Any]) -> dict[str, Any]:
    q = await db.execute(
        select(Series)
        .where(Series.owner_id == user_id, Series.status != "archived")
        .options(selectinload(Series.posts))
        .order_by(Series.start_at.asc())
    )
    items = list(q.scalars().all())
    return {
        "ok": True,
        "count": len(items),
        "items": [
            {
                "id": s.id,
                "title": s.title,
                "platform": s.platform,
                "start_at": s.start_at.isoformat() if s.start_at else None,
                "post_count": len(s.posts),
            }
            for s in items
        ],
    }


TOOL_HANDLERS = {
    "create_series": _tool_create_series,
    "create_post": _tool_create_post,
    "query_upcoming_posts": _tool_query_upcoming,
    "list_series": _tool_list_series,
}


# ─── Moonshot call ────────────────────────────────────────────
async def _call_moonshot(messages: list[dict[str, Any]]) -> dict[str, Any]:
    if not settings.moonshot_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": "moonshot_api_key_missing",
                "message": (
                    "MOONSHOT_API_KEY is not set. Add it to backend/.env "
                    "(see backend/.env.example) and restart the server."
                ),
            },
        )
    payload = {
        "model": settings.moonshot_model,
        "messages": messages,
        "tools": TOOL_CATALOG,
        "tool_choice": "auto",
        # kimi-k2.5 / 2.6 only accept temperature=1; using a hard
        # constant is safer than reading from env here.
        "temperature": 1,
    }
    headers = {
        "Authorization": f"Bearer {settings.moonshot_api_key}",
        "Content-Type": "application/json",
    }
    timeout = httpx.Timeout(60.0, connect=10.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(
            f"{settings.moonshot_base}/chat/completions", headers=headers, json=payload
        )
        if resp.status_code >= 400:
            logger.warning("Moonshot %s: %s", resp.status_code, resp.text)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail={
                    "error": "moonshot_upstream_error",
                    "message": f"Moonshot returned {resp.status_code}: {resp.text[:400]}",
                },
            )
        return resp.json()


def _system_prompt() -> str:
    now = datetime.utcnow()
    return (
        "You are the Scheduler Agent for a Creator Content Scheduler app. "
        "You help the user plan, schedule, and inspect social media posts "
        "and 4-stage content series (Teaser → Announcement → Follow-up → "
        "Reminder).\n\n"
        f"Current UTC time: {now.isoformat()}.\n"
        "All datetimes you generate must be in the FUTURE and in ISO 8601 "
        "without timezone (interpreted as America/New_York wall clock, "
        "EST). Default time when the user doesn't specify is 13:00 (1 pm).\n\n"
        "RULES:\n"
        "- A series runs on a single platform (instagram, tiktok, youtube, "
        "twitter, linkedin). When the user asks for the SAME series across "
        "multiple platforms, call create_series once for the FIRST platform, "
        "then for EACH additional platform call create_series again and "
        "PASS source_series_id set to the id returned by the first call. "
        "This links them as a cross-platform family so the UI groups them "
        "into one card with platform tabs instead of rendering N unrelated "
        "series with the same title. Omit source_series_id only when the "
        "user wants a brand-new unrelated series.\n"
        "- Same-platform posts must be at least 15 minutes apart.\n"
        "- For series: when the user gives only the Teaser time, auto-space "
        "Announcement at +1 day, Follow-up at +2 days, Reminder at +3 days "
        "(all at the same time of day). If the user provides explicit "
        "stage times, use them.\n"
        "- Default each post status to 'scheduled' and write a short, "
        "tasteful body for each stage if the user doesn't supply one.\n"
        "- For questions about counts ('how many posts this week'), call "
        "query_upcoming_posts with the matching range and answer with the "
        "count and a 1-line breakdown.\n"
        "- Be concise. After taking actions, give a 1–2 sentence "
        "confirmation summarising what was scheduled."
    )


# ─── The endpoint ─────────────────────────────────────────────
@router.post("/chat", response_model=ChatResponse)
async def chat(
    req: ChatRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user_id: Annotated[int, Depends(get_current_user_id)],
):
    messages: list[dict[str, Any]] = [{"role": "system", "content": _system_prompt()}]
    for h in req.history[-10:]:  # cap context
        if h.role in ("user", "assistant") and h.content:
            messages.append({"role": h.role, "content": h.content})
    messages.append({"role": "user", "content": req.message})

    actions: list[AgentAction] = []
    used_tools: list[str] = []

    for _ in range(MAX_ITERS):
        data = await _call_moonshot(messages)
        choice = data["choices"][0]
        msg = choice["message"]
        tool_calls = msg.get("tool_calls") or []

        # Always echo the assistant turn into history (even if empty content).
        # Reasoning models (kimi-k2.5/2.6) reject the next request unless
        # we round-trip reasoning_content from any tool-calling turn.
        assistant_msg: dict[str, Any] = {
            "role": "assistant",
            "content": msg.get("content") or "",
        }
        if tool_calls:
            assistant_msg["tool_calls"] = tool_calls
        if msg.get("reasoning_content"):
            assistant_msg["reasoning_content"] = msg["reasoning_content"]
        messages.append(assistant_msg)

        if not tool_calls:
            return ChatResponse(
                reply=msg.get("content") or "(no reply)",
                actions=actions,
                used_tools=used_tools,
            )

        # Execute every tool the model asked for, append results.
        for tc in tool_calls:
            fn = tc["function"]
            name = fn["name"]
            try:
                args = json.loads(fn.get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            handler = TOOL_HANDLERS.get(name)
            used_tools.append(name)
            if handler is None:
                result = {"ok": False, "error": f"unknown tool {name}"}
            else:
                try:
                    result = await handler(db, user_id, args)
                except Exception as exc:  # noqa: BLE001 — surface to model
                    logger.exception("tool %s crashed", name)
                    result = {"ok": False, "error": str(exc)}

            # Build a friendly action log entry for the UI.
            if name == "create_series" and result.get("ok"):
                actions.append(AgentAction(
                    type="series_created",
                    summary=f"Created series '{result['title']}' ({result['platform']}) with 4 posts.",
                    data=result,
                ))
            elif name == "create_post" and result.get("ok"):
                actions.append(AgentAction(
                    type="post_created",
                    summary=f"Scheduled '{result['title']}' on {result['platform']} for {result['scheduled_at']}.",
                    data=result,
                ))
            elif name == "query_upcoming_posts" and result.get("ok"):
                actions.append(AgentAction(
                    type="query",
                    summary=f"Found {result['count']} upcoming posts in window.",
                    data=result,
                ))
            elif name == "list_series" and result.get("ok"):
                actions.append(AgentAction(
                    type="query",
                    summary=f"Listed {result['count']} active series.",
                    data=result,
                ))
            elif not result.get("ok"):
                actions.append(AgentAction(
                    type="tool_error",
                    summary=f"{name} failed: {result.get('error')}",
                    data=result,
                ))

            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": json.dumps(result),
                }
            )

    return ChatResponse(
        reply="(agent stopped after maximum iterations — try a simpler prompt)",
        actions=actions,
        used_tools=used_tools,
    )
