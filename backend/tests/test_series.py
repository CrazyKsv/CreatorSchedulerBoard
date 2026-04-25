"""End-to-end tests for /api/series.

Test-first per Constitution Principle IX. Committed FAILING before
backend/app/api/series.py existed.

Coverage includes: happy path, atomic abort on conflict, ownership
scoping, cascade delete (including published posts per Clarify-Q5),
frozen post titles on rename (Clarify-Q8), past start_at allowed
(Clarify-Q6), FR-002a auto-title format.
"""
from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import select, func

from app.core.database import AsyncSessionLocal
from app.models.post import Post
from app.models.series import Series


async def _register_and_token(client: AsyncClient, email: str):
    await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "pw", "full_name": email.split("@")[0]},
    )
    r = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": "pw"}
    )
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _stages(platforms=None, base_time="2026-05-01T09:00:00+00:00"):
    """Build the 4-stage list for the templated series-create body.

    `platforms` is a list of 4 platform strings; default all 'instagram'.
    `base_time` is the Teaser's scheduled_at; subsequent stages are +7 days each.
    """
    from datetime import datetime as _dt, timedelta as _td

    plats = platforms or ["instagram"] * 4
    t0 = _dt.fromisoformat(base_time.replace("Z", "+00:00"))
    labels = ["Teaser", "Announcement", "Follow-up", "Reminder"]
    return [
        {
            "stage": labels[i],
            "platform": plats[i],
            "title": f"{labels[i]} post",
            "body": f"{labels[i]} body copy.",
            "scheduled_at": (t0 + _td(days=7 * i)).isoformat(),
        }
        for i in range(4)
    ]


def _payload(**overrides):
    """003 templated series-create body (T023 schema rewrite).

    Overrides map directly onto the new 4-stage shape. Pass `stages=[...]`
    to override per-stage content, or `title`/`description` for the series.
    """
    base = {
        "title": "Launch campaign",
        "description": "Teaser -> announcement -> follow-up -> reminder",
        "stages": _stages(),
    }
    base.update(overrides)
    return base


# ============================================================
# POST /api/series — create (US1)
# ============================================================


@pytest.mark.asyncio
async def test_create_series_4_stage_happy_path(client: AsyncClient, auth_headers):
    """003 T022: templated 4-stage body replaces cadence-based body.
    Replaces 002's `test_create_series_happy_path`. Verifies stages persist
    with their user-supplied title/body/platform/scheduled_at, positions
    are 0..3, and stage labels match the template."""
    r = await client.post("/api/v1/series", headers=auth_headers, json=_payload())
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["title"] == "Launch campaign"
    assert body["status"] == "active"
    posts = body["posts"]
    assert len(posts) == 4
    expected_labels = ["Teaser", "Announcement", "Follow-up", "Reminder"]
    for i, p in enumerate(posts):
        assert p["series_position"] == i
        assert p["series_id"] == body["id"]
        assert p["status"] == "scheduled"
        assert p["stage"] == expected_labels[i]
        assert p["title"] == f"{expected_labels[i]} post"
        assert p["body"] == f"{expected_labels[i]} body copy."
    # Timestamps: 7 days apart each (the _stages default cadence).
    times = [
        datetime.fromisoformat(p["scheduled_at"].replace("Z", "+00:00"))
        for p in posts
    ]
    for i in range(1, len(times)):
        assert (times[i] - times[i - 1]).days == 7


@pytest.mark.asyncio
async def test_create_series_requires_auth(client: AsyncClient):
    r = await client.post("/api/v1/series", json=_payload())
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_create_series_with_past_scheduled_at_rejected(
    client: AsyncClient, auth_headers
):
    """Future-time enforcement (EST): every stage must be in the future.
    Supersedes the earlier Clarify-Q6 allowance."""
    past_base = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
    payload = _payload(stages=_stages(base_time=past_base))
    r = await client.post("/api/v1/series", headers=auth_headers, json=payload)
    assert r.status_code == 422, r.text
    assert r.json()["detail"]["error"] == "scheduled_at_in_past"


@pytest.mark.asyncio
async def test_create_series_blocks_on_existing_post_conflict_atomic_abort(
    client: AsyncClient, auth_headers
):
    """FR-003 + FR-011: on conflict, 409 + no series or posts written."""
    # Seed a conflicting post 5 minutes after the would-be start_at.
    await client.post(
        "/api/v1/posts",
        headers=auth_headers,
        json={
            "title": "blocker",
            "platform": "instagram",
            "status": "scheduled",
            "scheduled_at": "2026-05-01T09:05:00+00:00",
        },
    )
    r = await client.post("/api/v1/series", headers=auth_headers, json=_payload())
    assert r.status_code == 409
    body = r.json()["detail"]
    assert body["error"] == "platform_gap_conflict"
    assert body["series_post_index"] == 0  # first generated post is the one

    # Atomic abort: exactly 1 post (the blocker) and 0 series rows.
    async with AsyncSessionLocal() as db:
        post_count = (await db.execute(select(func.count()).select_from(Post))).scalar()
        series_count = (await db.execute(select(func.count()).select_from(Series))).scalar()
    assert post_count == 1
    assert series_count == 0


# ============================================================
# 003 Phase 7 — Templated series-create TF (T022)
# Edge-case coverage per user's /speckit-implement directive.
# ============================================================


@pytest.mark.asyncio
async def test_create_series_wrong_stage_order_returns_422(
    client: AsyncClient, auth_headers
):
    """Stage at position 0 MUST be `Teaser`. Swapping order yields 422."""
    stages = _stages()
    # Swap Teaser (0) and Announcement (1) labels.
    stages[0]["stage"], stages[1]["stage"] = stages[1]["stage"], stages[0]["stage"]
    r = await client.post(
        "/api/v1/series", headers=auth_headers, json=_payload(stages=stages)
    )
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_create_series_missing_stages_returns_422(
    client: AsyncClient, auth_headers
):
    """<4 stages — Pydantic min_length=4 guard."""
    stages = _stages()[:3]
    r = await client.post(
        "/api/v1/series", headers=auth_headers, json=_payload(stages=stages)
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_series_too_many_stages_returns_422(
    client: AsyncClient, auth_headers
):
    """>4 stages — Pydantic max_length=4 guard."""
    stages = _stages() + [
        {
            "stage": "Reminder",
            "platform": "instagram",
            "title": "extra",
            "body": "extra",
            "scheduled_at": "2026-06-01T09:00:00+00:00",
        }
    ]
    r = await client.post(
        "/api/v1/series", headers=auth_headers, json=_payload(stages=stages)
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_series_invalid_stage_label_returns_422(
    client: AsyncClient, auth_headers
):
    """Stage label outside the Literal set yields 422."""
    stages = _stages()
    stages[2]["stage"] = "Recap"  # not in Literal
    r = await client.post(
        "/api/v1/series", headers=auth_headers, json=_payload(stages=stages)
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_series_duplicate_stage_label_returns_422(
    client: AsyncClient, auth_headers
):
    """All four stages labelled 'Teaser' — position-vs-label check rejects."""
    stages = _stages()
    for s in stages:
        s["stage"] = "Teaser"
    r = await client.post(
        "/api/v1/series", headers=auth_headers, json=_payload(stages=stages)
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_series_sequential_integrity_violation_returns_409(
    client: AsyncClient, auth_headers
):
    """Stage 1's scheduled_at BEFORE stage 0's — FR-020 violation."""
    stages = _stages()
    t0 = datetime.fromisoformat(stages[0]["scheduled_at"].replace("Z", "+00:00"))
    stages[1]["scheduled_at"] = (t0 - timedelta(hours=1)).isoformat()
    r = await client.post(
        "/api/v1/series", headers=auth_headers, json=_payload(stages=stages)
    )
    assert r.status_code == 409, r.text
    body = r.json()["detail"]
    assert body["error"] == "sequential_integrity_violation"
    assert body["offending_post_index"] == 1
    assert body["prior_post_index"] == 0
    assert "stage #" in body["message"].lower()


@pytest.mark.asyncio
async def test_create_series_equal_adjacent_times_returns_409_sequential_integrity(
    client: AsyncClient, auth_headers
):
    """Equal adjacent scheduled_at times violate strict ordering."""
    stages = _stages()
    stages[1]["scheduled_at"] = stages[0]["scheduled_at"]
    r = await client.post(
        "/api/v1/series", headers=auth_headers, json=_payload(stages=stages)
    )
    assert r.status_code == 409
    assert r.json()["detail"]["error"] == "sequential_integrity_violation"


@pytest.mark.asyncio
async def test_create_series_stage_collision_with_existing_post_returns_409_with_index(
    client: AsyncClient, auth_headers
):
    """FR-021: conflict against an existing post yields 409 with the
    series_post_index identifying which stage collided."""
    # Seed a blocker 5 min away from stage #2's (Follow-up) scheduled time.
    stages = _stages()
    t2 = datetime.fromisoformat(stages[2]["scheduled_at"].replace("Z", "+00:00"))
    await client.post(
        "/api/v1/posts",
        headers=auth_headers,
        json={
            "title": "blocker",
            "platform": stages[2]["platform"],
            "status": "scheduled",
            "scheduled_at": (t2 + timedelta(minutes=5)).isoformat(),
        },
    )
    r = await client.post(
        "/api/v1/series", headers=auth_headers, json=_payload(stages=stages)
    )
    assert r.status_code == 409, r.text
    body = r.json()["detail"]
    assert body["error"] == "platform_gap_conflict"
    assert body["series_post_index"] == 2


@pytest.mark.asyncio
async def test_create_series_sibling_collision_within_same_platform_returns_409(
    client: AsyncClient, auth_headers
):
    """FR-019: two same-platform siblings 5 min apart — rejected."""
    stages = _stages()
    # Keep stages[0] at default; place stages[1] 5 min later on same platform.
    t0 = datetime.fromisoformat(stages[0]["scheduled_at"].replace("Z", "+00:00"))
    stages[1]["scheduled_at"] = (t0 + timedelta(minutes=5)).isoformat()
    # Ensure ordering stays strictly monotonic to isolate the 15-min check.
    stages[2]["scheduled_at"] = (t0 + timedelta(hours=1)).isoformat()
    stages[3]["scheduled_at"] = (t0 + timedelta(hours=2)).isoformat()
    r = await client.post(
        "/api/v1/series", headers=auth_headers, json=_payload(stages=stages)
    )
    assert r.status_code == 409
    body = r.json()["detail"]
    assert body["error"] == "platform_gap_conflict"
    assert body["series_post_index"] == 1


@pytest.mark.asyncio
async def test_create_series_sibling_same_platform_exactly_15min_apart_accepted(
    client: AsyncClient, auth_headers
):
    """Strict < boundary: exactly 15 min siblings on same platform — OK."""
    stages = _stages()
    t0 = datetime.fromisoformat(stages[0]["scheduled_at"].replace("Z", "+00:00"))
    stages[1]["scheduled_at"] = (t0 + timedelta(minutes=15)).isoformat()
    stages[2]["scheduled_at"] = (t0 + timedelta(minutes=30)).isoformat()
    stages[3]["scheduled_at"] = (t0 + timedelta(minutes=45)).isoformat()
    r = await client.post(
        "/api/v1/series", headers=auth_headers, json=_payload(stages=stages)
    )
    assert r.status_code == 201, r.text


@pytest.mark.asyncio
async def test_create_series_per_stage_platform_mix_rejected_004(
    client: AsyncClient, auth_headers
):
    """004: reinstates a stricter version of 002 FR-005. 003 briefly let
    stages carry different platforms; 004 locks a series to one platform
    (Clone action covers the cross-channel case) so this now returns 422."""
    stages = _stages(
        platforms=["instagram", "twitter", "linkedin", "youtube"]
    )
    r = await client.post(
        "/api/v1/series", headers=auth_headers, json=_payload(stages=stages)
    )
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_create_series_atomic_abort_on_conflict_zero_writes(
    client: AsyncClient, auth_headers
):
    """On any 409/422, no series row and no post rows are persisted."""
    stages = _stages()
    # Force sibling collision at stage 3 on youtube; ensure stages 0-2 OK.
    stages[3]["platform"] = stages[2]["platform"]  # same-platform pair
    t3 = datetime.fromisoformat(stages[2]["scheduled_at"].replace("Z", "+00:00"))
    stages[3]["scheduled_at"] = (t3 + timedelta(minutes=3)).isoformat()
    r = await client.post(
        "/api/v1/series", headers=auth_headers, json=_payload(stages=stages)
    )
    assert r.status_code == 409
    async with AsyncSessionLocal() as db:
        series_count = (
            await db.execute(select(func.count()).select_from(Series))
        ).scalar()
        post_count = (
            await db.execute(select(func.count()).select_from(Post))
        ).scalar()
    assert series_count == 0
    assert post_count == 0


@pytest.mark.asyncio
async def test_create_series_empty_title_returns_422(
    client: AsyncClient, auth_headers
):
    r = await client.post(
        "/api/v1/series", headers=auth_headers, json=_payload(title="")
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_series_empty_stage_title_returns_422(
    client: AsyncClient, auth_headers
):
    stages = _stages()
    stages[2]["title"] = ""
    r = await client.post(
        "/api/v1/series", headers=auth_headers, json=_payload(stages=stages)
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_series_description_is_optional(
    client: AsyncClient, auth_headers
):
    """Description may be omitted."""
    payload = _payload()
    payload.pop("description", None)
    r = await client.post("/api/v1/series", headers=auth_headers, json=payload)
    assert r.status_code == 201, r.text
    assert r.json()["description"] is None


@pytest.mark.asyncio
async def test_create_series_body_per_stage_is_optional(
    client: AsyncClient, auth_headers
):
    """Each stage may omit its body."""
    stages = _stages()
    for s in stages:
        s.pop("body", None)
    r = await client.post(
        "/api/v1/series", headers=auth_headers, json=_payload(stages=stages)
    )
    assert r.status_code == 201, r.text
    for p in r.json()["posts"]:
        assert p["body"] is None


@pytest.mark.asyncio
async def test_create_series_missing_stage_scheduled_at_returns_422(
    client: AsyncClient, auth_headers
):
    """stage.scheduled_at is required."""
    stages = _stages()
    stages[2].pop("scheduled_at")
    r = await client.post(
        "/api/v1/series", headers=auth_headers, json=_payload(stages=stages)
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_series_invalid_platform_returns_422(
    client: AsyncClient, auth_headers
):
    stages = _stages()
    stages[0]["platform"] = "mySpace"  # not in the literal
    r = await client.post(
        "/api/v1/series", headers=auth_headers, json=_payload(stages=stages)
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_series_doesnt_block_on_other_owners_posts(
    client: AsyncClient, auth_headers
):
    """Owner isolation: bob's same-platform same-time post must not block
    alice's series creation."""
    bob = await _register_and_token(client, "bob-foreign@example.com")
    await client.post(
        "/api/v1/posts",
        headers=bob,
        json={
            "title": "bob's post",
            "platform": "instagram",
            "status": "scheduled",
            "scheduled_at": "2026-05-01T09:05:00+00:00",
        },
    )
    r = await client.post("/api/v1/series", headers=auth_headers, json=_payload())
    assert r.status_code == 201


@pytest.mark.asyncio
async def test_create_series_respects_archived_exclusion_on_15min_check(
    client: AsyncClient, auth_headers
):
    """FR-018 integration: archived existing post does not block a series
    stage that would otherwise collide with it."""
    await client.post(
        "/api/v1/posts",
        headers=auth_headers,
        json={
            "title": "archived-blocker",
            "platform": "instagram",
            "status": "scheduled",
            "scheduled_at": "2026-05-01T09:05:00+00:00",
        },
    )
    # Find that post and archive it.
    listed = await client.get(
        "/api/v1/posts", headers=auth_headers
    )
    post_id = listed.json()[0]["id"]
    await client.post(
        f"/api/v1/posts/{post_id}/archive", headers=auth_headers
    )
    r = await client.post("/api/v1/series", headers=auth_headers, json=_payload())
    assert r.status_code == 201, r.text


# ============================================================
# GET /api/series — list + detail (US3)
# ============================================================


@pytest.mark.asyncio
async def test_list_series_empty(client: AsyncClient, auth_headers):
    r = await client.get("/api/v1/series", headers=auth_headers)
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_list_series_returns_eager_loaded_posts(
    client: AsyncClient, auth_headers
):
    """003 list_series now eager-loads posts so the Dashboard's ListView can
    render stage rows inline without an N+1 detail fetch per series.
    Replaces 002's `test_list_series_returns_summary_without_posts`."""
    await client.post("/api/v1/series", headers=auth_headers, json=_payload())
    r = await client.get("/api/v1/series", headers=auth_headers)
    assert r.status_code == 200
    series = r.json()
    assert len(series) == 1
    assert "posts" in series[0]
    assert len(series[0]["posts"]) == 4
    assert [p["series_position"] for p in series[0]["posts"]] == [0, 1, 2, 3]


@pytest.mark.asyncio
async def test_list_series_scoped_to_owner(client: AsyncClient, auth_headers):
    # Alice (auth_headers) creates a series.
    await client.post("/api/v1/series", headers=auth_headers, json=_payload())
    # Bob registers and lists — should see nothing.
    bob = await _register_and_token(client, "bob@example.com")
    r = await client.get("/api/v1/series", headers=bob)
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_get_series_returns_posts_ordered_by_position(
    client: AsyncClient, auth_headers
):
    created = await client.post("/api/v1/series", headers=auth_headers, json=_payload())
    series_id = created.json()["id"]
    r = await client.get(f"/api/v1/series/{series_id}", headers=auth_headers)
    assert r.status_code == 200
    posts = r.json()["posts"]
    assert [p["series_position"] for p in posts] == [0, 1, 2, 3]


@pytest.mark.asyncio
async def test_get_series_404_for_other_owner(client: AsyncClient, auth_headers):
    created = await client.post("/api/v1/series", headers=auth_headers, json=_payload())
    series_id = created.json()["id"]
    bob = await _register_and_token(client, "bob@example.com")
    r = await client.get(f"/api/v1/series/{series_id}", headers=bob)
    assert r.status_code == 404


# ============================================================
# PATCH /api/series/{id} — edit title/description only (US3)
# ============================================================


@pytest.mark.asyncio
async def test_patch_series_title_does_not_modify_user_supplied_post_titles(
    client: AsyncClient, auth_headers
):
    """003 replacement of 002's `test_patch_series_title_preserves_post_titles`:
    there is no auto-title format any more (each post's title is supplied
    per-stage), so PATCHing the series name MUST NOT touch the
    user-supplied post titles."""
    created = await client.post(
        "/api/v1/series",
        headers=auth_headers,
        json=_payload(title="Spring launch"),
    )
    series_id = created.json()["id"]
    original_post_titles = [p["title"] for p in created.json()["posts"]]

    r = await client.patch(
        f"/api/v1/series/{series_id}",
        headers=auth_headers,
        json={"title": "Summer launch"},
    )
    assert r.status_code == 200
    assert r.json()["title"] == "Summer launch"

    detail = await client.get(f"/api/v1/series/{series_id}", headers=auth_headers)
    current_post_titles = [p["title"] for p in detail.json()["posts"]]
    assert current_post_titles == original_post_titles


@pytest.mark.asyncio
async def test_patch_series_ignores_immutable_fields(
    client: AsyncClient, auth_headers
):
    """FR-005: only title/description editable. Other fields silently ignored
    (SeriesUpdate schema drops them via pydantic's exclude_unset pattern)."""
    created = await client.post(
        "/api/v1/series", headers=auth_headers, json=_payload(platform="instagram")
    )
    series_id = created.json()["id"]
    r = await client.patch(
        f"/api/v1/series/{series_id}",
        headers=auth_headers,
        json={"platform": "tiktok", "post_count": 99},
    )
    assert r.status_code == 200
    assert r.json()["platform"] == "instagram"
    assert r.json()["post_count"] == 4


# ============================================================
# DELETE /api/series/{id} — cascade (US3)
# ============================================================


@pytest.mark.asyncio
async def test_delete_series_cascades_posts(client: AsyncClient, auth_headers):
    created = await client.post("/api/v1/series", headers=auth_headers, json=_payload())
    series_id = created.json()["id"]
    r = await client.delete(f"/api/v1/series/{series_id}", headers=auth_headers)
    assert r.status_code == 204

    # Series row gone.
    r2 = await client.get(f"/api/v1/series/{series_id}", headers=auth_headers)
    assert r2.status_code == 404
    # No posts left.
    async with AsyncSessionLocal() as db:
        post_count = (
            await db.execute(
                select(func.count()).select_from(Post).where(Post.series_id == series_id)
            )
        ).scalar()
    assert post_count == 0


@pytest.mark.asyncio
async def test_delete_series_with_published_post_returns_409_series_has_published_posts(
    client: AsyncClient, auth_headers
):
    """FR-016 (003 supersedes 002 Clarify-Q5): DELETE is rejected when any
    child post is published. The user must Archive the series instead.
    Rewritten in Phase 6 (T020); previously this test asserted
    unconditional cascade (`test_delete_series_unconditionally_cascades_published_posts`).
    """
    created = await client.post("/api/v1/series", headers=auth_headers, json=_payload())
    series_id = created.json()["id"]
    first_post_id = created.json()["posts"][0]["id"]

    async with AsyncSessionLocal() as db:
        post = (
            await db.execute(select(Post).where(Post.id == first_post_id))
        ).scalar_one()
        post.status = "published"
        await db.commit()

    r = await client.delete(f"/api/v1/series/{series_id}", headers=auth_headers)
    assert r.status_code == 409
    body = r.json()["detail"]
    assert body["error"] == "series_has_published_posts"
    assert "archive" in body["message"].lower()

    # The series row and all of its posts are still present.
    async with AsyncSessionLocal() as db:
        series_still = (
            await db.execute(select(Series).where(Series.id == series_id))
        ).scalar_one_or_none()
        post_count = (
            await db.execute(
                select(func.count()).select_from(Post).where(Post.series_id == series_id)
            )
        ).scalar()
    assert series_still is not None
    assert post_count == 4


@pytest.mark.asyncio
async def test_delete_series_404_for_other_owner(client: AsyncClient, auth_headers):
    created = await client.post("/api/v1/series", headers=auth_headers, json=_payload())
    series_id = created.json()["id"]
    bob = await _register_and_token(client, "bob@example.com")
    r = await client.delete(f"/api/v1/series/{series_id}", headers=bob)
    assert r.status_code == 404


# ============================================================
# 003 Phase 6 — Series archive / unarchive (FR-017, T018)
# ============================================================


@pytest.mark.asyncio
async def test_archive_series_cascades_to_all_posts(
    client: AsyncClient, auth_headers
):
    """FR-017: archiving a series flips the series + every child post to
    'archived', each preserving its own previous_status."""
    created = await client.post(
        "/api/v1/series", headers=auth_headers, json=_payload()
    )
    series_id = created.json()["id"]

    r = await client.post(
        f"/api/v1/series/{series_id}/archive", headers=auth_headers
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "archived"
    assert body["previous_status"] == "active"
    assert len(body["posts"]) == 4
    for p in body["posts"]:
        assert p["status"] == "archived"
        # All 4 posts started scheduled.
        assert p["previous_status"] == "scheduled"


@pytest.mark.asyncio
async def test_archive_series_does_not_overwrite_already_archived_child_previous(
    client: AsyncClient, auth_headers
):
    """No-stacking invariant (data-model.md §6): if a child post was
    individually archived BEFORE the series archive ran, the series
    archive MUST NOT overwrite that post's previous_status."""
    created = await client.post(
        "/api/v1/series", headers=auth_headers, json=_payload()
    )
    series_id = created.json()["id"]
    first_post_id = created.json()["posts"][0]["id"]

    # Step 1: individually archive the first post. previous_status="scheduled".
    await client.post(
        f"/api/v1/posts/{first_post_id}/archive", headers=auth_headers
    )

    # Step 2: archive the series.
    r = await client.post(
        f"/api/v1/series/{series_id}/archive", headers=auth_headers
    )
    assert r.status_code == 200
    first_post = next(p for p in r.json()["posts"] if p["id"] == first_post_id)
    assert first_post["status"] == "archived"
    # previous_status stays "scheduled" — NOT overwritten to "archived".
    assert first_post["previous_status"] == "scheduled"


@pytest.mark.asyncio
async def test_unarchive_series_lands_all_posts_in_draft(
    client: AsyncClient, auth_headers
):
    """006 contract — series-unarchive cascade lands every child post in
    `draft`, never back to its previous status. Series itself returns
    to `active`."""
    created = await client.post(
        "/api/v1/series", headers=auth_headers, json=_payload()
    )
    series_id = created.json()["id"]

    await client.post(
        f"/api/v1/series/{series_id}/archive", headers=auth_headers
    )
    r = await client.post(
        f"/api/v1/series/{series_id}/unarchive", headers=auth_headers
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "active"
    assert body["previous_status"] is None
    for p in body["posts"]:
        assert p["status"] == "draft"
        assert p["previous_status"] is None


@pytest.mark.asyncio
async def test_archive_unarchive_series_round_trip_preserves_schedule_and_title(
    client: AsyncClient, auth_headers
):
    """Round-trip is no longer lossless on STATUS (006 contract — every
    unarchive lands in draft) but it MUST still preserve `scheduled_at`
    and `title` so the user doesn't have to retype anything."""
    created = await client.post(
        "/api/v1/series", headers=auth_headers, json=_payload()
    )
    series_id = created.json()["id"]
    before = created.json()
    before_posts = sorted(before["posts"], key=lambda p: p["id"])

    await client.post(
        f"/api/v1/series/{series_id}/archive", headers=auth_headers
    )
    r = await client.post(
        f"/api/v1/series/{series_id}/unarchive", headers=auth_headers
    )
    after = r.json()
    after_posts = sorted(after["posts"], key=lambda p: p["id"])

    assert after["status"] == "active"
    assert after["previous_status"] is None
    for before_p, after_p in zip(before_posts, after_posts):
        # Status intentionally flips to draft (006); previous_status cleared.
        assert after_p["status"] == "draft"
        assert after_p["previous_status"] is None
        # Time + title preserved so editing back to scheduled is one click.
        assert after_p["scheduled_at"] == before_p["scheduled_at"]
        assert after_p["title"] == before_p["title"]


@pytest.mark.asyncio
async def test_archive_already_archived_series_returns_409_already_archived(
    client: AsyncClient, auth_headers
):
    created = await client.post(
        "/api/v1/series", headers=auth_headers, json=_payload()
    )
    series_id = created.json()["id"]
    await client.post(
        f"/api/v1/series/{series_id}/archive", headers=auth_headers
    )
    r = await client.post(
        f"/api/v1/series/{series_id}/archive", headers=auth_headers
    )
    assert r.status_code == 409
    assert r.json()["detail"]["error"] == "already_archived"


@pytest.mark.asyncio
async def test_unarchive_not_archived_series_returns_409_not_archived(
    client: AsyncClient, auth_headers
):
    created = await client.post(
        "/api/v1/series", headers=auth_headers, json=_payload()
    )
    series_id = created.json()["id"]
    r = await client.post(
        f"/api/v1/series/{series_id}/unarchive", headers=auth_headers
    )
    assert r.status_code == 409
    assert r.json()["detail"]["error"] == "not_archived"


@pytest.mark.asyncio
async def test_archive_series_404_not_found(client: AsyncClient, auth_headers):
    r = await client.post("/api/v1/series/999999/archive", headers=auth_headers)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_unarchive_series_404_not_found(client: AsyncClient, auth_headers):
    r = await client.post(
        "/api/v1/series/999999/unarchive", headers=auth_headers
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_archive_series_404_for_other_owner(
    client: AsyncClient, auth_headers
):
    """FR-028 ownership scoping for series archive."""
    created = await client.post(
        "/api/v1/series", headers=auth_headers, json=_payload()
    )
    series_id = created.json()["id"]
    bob = await _register_and_token(client, "bob-series-archive@example.com")
    r = await client.post(f"/api/v1/series/{series_id}/archive", headers=bob)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_unarchive_series_404_for_other_owner(
    client: AsyncClient, auth_headers
):
    created = await client.post(
        "/api/v1/series", headers=auth_headers, json=_payload()
    )
    series_id = created.json()["id"]
    await client.post(
        f"/api/v1/series/{series_id}/archive", headers=auth_headers
    )
    bob = await _register_and_token(client, "bob-series-unarchive@example.com")
    r = await client.post(f"/api/v1/series/{series_id}/unarchive", headers=bob)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_archive_series_requires_auth(client: AsyncClient):
    r = await client.post("/api/v1/series/1/archive")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_unarchive_series_requires_auth(client: AsyncClient):
    r = await client.post("/api/v1/series/1/unarchive")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_archive_series_with_published_post_cascades_to_archived_then_unarchives_to_draft(
    client: AsyncClient, auth_headers
):
    """FR-017 (006 amended): series-archive cascades all posts to
    `archived`, capturing their pre-archive status in `previous_status`
    (so the audit trail is preserved). Series-unarchive lands every
    cascaded post in `draft` — including ones that were previously
    `published`. The conservative rule applies uniformly: bringing a
    series back from archive starts every stage fresh, no auto-publish
    surprise. Operators who want a stage to be `published` again
    must publish it manually via POST /api/v1/posts/{id}/publish.
    """
    created = await client.post(
        "/api/v1/series", headers=auth_headers, json=_payload()
    )
    series_id = created.json()["id"]
    first_post_id = created.json()["posts"][0]["id"]

    # Promote one post to published.
    async with AsyncSessionLocal() as db:
        post = (
            await db.execute(select(Post).where(Post.id == first_post_id))
        ).scalar_one()
        post.status = "published"
        await db.commit()

    await client.post(
        f"/api/v1/series/{series_id}/archive", headers=auth_headers
    )

    # After archive all four posts are archived; the previously-published
    # one has previous_status="published" (kept for audit only — unarchive
    # will NOT use it to drive the restored status).
    detail = await client.get(
        f"/api/v1/series/{series_id}?include_archived=true", headers=auth_headers
    )
    first_post = next(
        p for p in detail.json()["posts"] if p["id"] == first_post_id
    )
    assert first_post["status"] == "archived"
    assert first_post["previous_status"] == "published"

    # Unarchive lands every post in `draft`, even the one that was
    # previously `published`. previous_status is cleared on unarchive.
    unarchive = await client.post(
        f"/api/v1/series/{series_id}/unarchive", headers=auth_headers
    )
    restored = next(
        p for p in unarchive.json()["posts"] if p["id"] == first_post_id
    )
    assert restored["status"] == "draft"
    assert restored["previous_status"] is None


# ============================================================
# 003 Phase 6 — Series DELETE guard + include_archived (FR-016, FR-025, T020)
# ============================================================


@pytest.mark.asyncio
async def test_delete_pre_execution_series_returns_204(
    client: AsyncClient, auth_headers
):
    """FR-016: series with zero published posts hard-deletes cleanly.
    Covers the common case (draft/scheduled posts can be discarded)."""
    created = await client.post(
        "/api/v1/series", headers=auth_headers, json=_payload()
    )
    series_id = created.json()["id"]
    r = await client.delete(
        f"/api/v1/series/{series_id}", headers=auth_headers
    )
    assert r.status_code == 204

    async with AsyncSessionLocal() as db:
        remaining = (
            await db.execute(
                select(func.count()).select_from(Post).where(Post.series_id == series_id)
            )
        ).scalar()
    assert remaining == 0


@pytest.mark.parametrize("non_blocking_status", ["draft", "scheduled", "failed", "archived"])
@pytest.mark.asyncio
async def test_delete_series_204_when_no_post_is_published(
    client: AsyncClient, auth_headers, non_blocking_status: str
):
    """Every non-published post status is non-blocking for DELETE."""
    created = await client.post(
        "/api/v1/series", headers=auth_headers, json=_payload()
    )
    series_id = created.json()["id"]
    first_post_id = created.json()["posts"][0]["id"]

    async with AsyncSessionLocal() as db:
        post = (
            await db.execute(select(Post).where(Post.id == first_post_id))
        ).scalar_one()
        post.status = non_blocking_status
        await db.commit()

    r = await client.delete(
        f"/api/v1/series/{series_id}", headers=auth_headers
    )
    assert r.status_code == 204


@pytest.mark.asyncio
async def test_delete_series_404_not_found(client: AsyncClient, auth_headers):
    r = await client.delete("/api/v1/series/999999", headers=auth_headers)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_delete_series_requires_auth(client: AsyncClient):
    r = await client.delete("/api/v1/series/1")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_list_series_excludes_archived_by_default(
    client: AsyncClient, auth_headers
):
    """FR-025: default list filters out archived series."""
    s1 = await client.post(
        "/api/v1/series", headers=auth_headers, json=_payload(title="Active")
    )
    s2 = await client.post(
        "/api/v1/series",
        headers=auth_headers,
        json=_payload(title="To archive", stages=_stages(base_time="2026-06-01T09:00:00+00:00")),
    )
    await client.post(
        f"/api/v1/series/{s2.json()['id']}/archive", headers=auth_headers
    )
    r = await client.get("/api/v1/series", headers=auth_headers)
    assert r.status_code == 200
    titles = {item["title"] for item in r.json()}
    assert titles == {"Active"}


@pytest.mark.asyncio
async def test_list_series_with_include_archived_true_returns_archived(
    client: AsyncClient, auth_headers
):
    s1 = await client.post(
        "/api/v1/series", headers=auth_headers, json=_payload(title="Active")
    )
    s2 = await client.post(
        "/api/v1/series",
        headers=auth_headers,
        json=_payload(title="Archived", stages=_stages(base_time="2026-06-01T09:00:00+00:00")),
    )
    await client.post(
        f"/api/v1/series/{s2.json()['id']}/archive", headers=auth_headers
    )
    r = await client.get(
        "/api/v1/series?include_archived=true", headers=auth_headers
    )
    assert r.status_code == 200
    titles = {item["title"] for item in r.json()}
    assert titles == {"Active", "Archived"}


@pytest.mark.asyncio
async def test_list_series_with_include_archived_false_excludes_archived(
    client: AsyncClient, auth_headers
):
    """Explicit include_archived=false behaves the same as omission."""
    s1 = await client.post(
        "/api/v1/series", headers=auth_headers, json=_payload(title="Active")
    )
    s2 = await client.post(
        "/api/v1/series",
        headers=auth_headers,
        json=_payload(title="Archived", stages=_stages(base_time="2026-06-01T09:00:00+00:00")),
    )
    await client.post(
        f"/api/v1/series/{s2.json()['id']}/archive", headers=auth_headers
    )
    r = await client.get(
        "/api/v1/series?include_archived=false", headers=auth_headers
    )
    assert r.status_code == 200
    titles = {item["title"] for item in r.json()}
    assert titles == {"Active"}


# ============================================================
# 004 — single-platform series invariant
# ============================================================


@pytest.mark.asyncio
async def test_create_series_mixed_platform_stages_returns_422(
    client: AsyncClient, auth_headers
):
    """A series is one narrative arc on one channel. Mixing platforms across
    the 4 stages is rejected by the SeriesCreate model validator; users
    who want the same arc on another channel must Clone the series."""
    payload = _payload(
        stages=_stages(
            platforms=["instagram", "twitter", "instagram", "twitter"]
        )
    )
    r = await client.post("/api/v1/series", headers=auth_headers, json=payload)
    assert r.status_code == 422, r.text


# ============================================================
# 004 — family_id grouping for cloned series
# ============================================================


@pytest.mark.asyncio
async def test_create_series_standalone_self_references_family_id(
    client: AsyncClient, auth_headers
):
    """A freshly-created series becomes its own singleton family: family_id
    equals the series's own id. This guarantees every row belongs to exactly
    one family, which lets the frontend group siblings under one card with
    platform tabs."""
    r = await client.post("/api/v1/series", headers=auth_headers, json=_payload())
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["family_id"] == body["id"]


@pytest.mark.asyncio
async def test_create_series_clone_joins_family(client: AsyncClient, auth_headers):
    """Cloning via source_series_id pulls the new series into the source's
    family so the UI can show both under one card. The child's family_id
    matches the parent's family_id (the anchor), not its own id."""
    src = await client.post(
        "/api/v1/series", headers=auth_headers, json=_payload(title="Spring")
    )
    assert src.status_code == 201, src.text
    src_body = src.json()
    assert src_body["family_id"] == src_body["id"]

    clone_payload = _payload(
        title="Spring (X)",
        stages=_stages(
            platforms=["twitter"] * 4,
            base_time="2026-07-01T09:00:00+00:00",
        ),
        source_series_id=src_body["id"],
    )
    clone = await client.post(
        "/api/v1/series", headers=auth_headers, json=clone_payload
    )
    assert clone.status_code == 201, clone.text
    clone_body = clone.json()
    assert clone_body["family_id"] == src_body["id"]
    assert clone_body["family_id"] != clone_body["id"]

    # A clone-of-a-clone should still point at the original anchor — flat,
    # not linked-list.
    grand_payload = _payload(
        title="Spring (LI)",
        stages=_stages(
            platforms=["linkedin"] * 4,
            base_time="2026-08-01T09:00:00+00:00",
        ),
        source_series_id=clone_body["id"],
    )
    grand = await client.post(
        "/api/v1/series", headers=auth_headers, json=grand_payload
    )
    assert grand.status_code == 201, grand.text
    assert grand.json()["family_id"] == src_body["id"]


@pytest.mark.asyncio
async def test_create_series_clone_unknown_source_returns_404(
    client: AsyncClient, auth_headers
):
    """A clone pointing at a non-existent source is rejected with 404 and
    the atomic write is aborted (no partial series row left behind)."""
    payload = _payload(source_series_id=999_999)
    r = await client.post("/api/v1/series", headers=auth_headers, json=payload)
    assert r.status_code == 404, r.text
    assert r.json()["detail"]["error"] == "source_series_not_found"
