#!/usr/bin/env python3
"""
Seed the local SQLite database with a small, deterministic dataset for
visualization and demo. Run from repo root:

    python backend/scripts/seed_data.py

Or from backend/:

    python scripts/seed_data.py

Layout (post-006 cleanup):
- 3 users (login flexibility — alice/bob/charlie, password "password123")
- Alice gets all the demo data; bob and charlie are empty so the
  per-user-scoping behaviour is easy to exercise too.
- Alice's data:
    * 2 series (one TikTok, one YouTube), each with the standard 4-stage
      template (Teaser → Announcement → Follow-up → Reminder).
    * 2 standalone scheduled posts (Instagram + X (Twitter)).
    * 2 standalone draft posts (no scheduled_at).

Time convention: every timestamp is a NAIVE datetime in EST wall-clock,
matching the project's wire format (see scheduling.is_past_est /
publisher._to_est). We deliberately do NOT call `datetime.utcnow()` —
that would store wall-clock numbers shifted by the host's UTC offset
and visibly misalign the seed against the dashboard once read back.
"""
import os
import sys
from datetime import timedelta
from pathlib import Path

# Add backend/ to path so we can import app.* when run from any cwd.
backend = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.core.security import get_password_hash
from app.core.database import Base
from app.core.scheduling import now_est_naive
from app.models.user import User
from app.models.post import Post
from app.models.series import Series

# Sync engine for the script (the async app uses sqlite+aiosqlite://).
_env_url = os.environ.get("DATABASE_URL")
if _env_url:
    DATABASE_URL = _env_url.replace("sqlite+aiosqlite://", "sqlite://", 1)
    DB_PATH = (
        DATABASE_URL.split("sqlite:///", 1)[-1]
        if "sqlite:///" in DATABASE_URL
        else DATABASE_URL
    )
else:
    DB_PATH = backend / "scheduler.db"
    DATABASE_URL = f"sqlite:///{DB_PATH}"

STAGE_LABELS = ["Teaser", "Announcement", "Follow-up", "Reminder"]


SERIES_PLANS = [
    {
        "title": "TikTok Drop Campaign",
        "description": "Four-stage TikTok run — one beat per day.",
        "platform": "tiktok",
        "stage_bodies": [
            "Short-form hook teaser.",
            "Drop-day announcement with creator demo.",
            "Reaction roundup follow-up.",
            "Reminder before the window closes.",
        ],
    },
    {
        "title": "Weekly Dev Log",
        "description": "Behind-the-scenes rollout of a new feature on YouTube.",
        "platform": "youtube",
        "stage_bodies": [
            "Teaser reel of the next feature.",
            "Deep-dive announcement video.",
            "Follow-up Q&A live.",
            "Reminder to subscribe before launch.",
        ],
    },
]


def main():
    engine = create_engine(DATABASE_URL, echo=False)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()

    # Idempotent users (password: password123). Bob and charlie are kept
    # empty — useful for verifying per-user scoping without duplicating
    # alice's data three times.
    hashed = get_password_hash("password123")
    users_data = [
        {"email": "alice@example.com", "full_name": "Alice Creator"},
        {"email": "bob@example.com", "full_name": "Bob Maker"},
        {"email": "charlie@example.com", "full_name": "Charlie Scheduler"},
    ]
    users = []
    for u in users_data:
        existing = session.query(User).filter(User.email == u["email"]).first()
        if existing:
            users.append(existing)
        else:
            user = User(
                email=u["email"],
                hashed_password=hashed,
                full_name=u["full_name"],
            )
            session.add(user)
            session.commit()
            session.refresh(user)
            users.append(user)

    alice = users[0]
    seed_user_ids = [u.id for u in users]

    # Reset the seed-user dataset so re-runs always produce the same final
    # state (alice with the deterministic dataset, bob/charlie empty).
    # Only rows whose owner_id is one of the three seed users are
    # touched — operator-created accounts (different email + different
    # owner_id) are never affected.
    deleted_posts = (
        session.query(Post)
        .filter(Post.owner_id.in_(seed_user_ids))
        .delete(synchronize_session=False)
    )
    deleted_series = (
        session.query(Series)
        .filter(Series.owner_id.in_(seed_user_ids))
        .delete(synchronize_session=False)
    )
    if deleted_posts or deleted_series:
        print(
            f"Cleared {deleted_posts} prior post(s) and {deleted_series} "
            f"prior series owned by alice/bob/charlie before re-seeding."
        )
    session.commit()

    base = now_est_naive().replace(hour=13, minute=0, second=0)
    # Series 1 (TikTok) starts 2 days out; Series 2 (YouTube) starts 5
    # days out. One stage per day for both, well clear of the 15-min
    # gap rule (different platforms anyway). All times are EST wall-clock.
    for plan_index, plan in enumerate(SERIES_PLANS):
        series_start = base + timedelta(days=2 + plan_index * 3)
        series = Series(
            title=plan["title"],
            description=plan["description"],
            platform=plan["platform"],
            start_at=series_start,
            cadence_unit="days",
            cadence_interval=1,
            post_count=4,
            owner_id=alice.id,
            status="active",
        )
        session.add(series)
        session.flush()
        # Self-reference: every fresh series is its own family anchor.
        series.family_id = series.id

        for pos, label in enumerate(STAGE_LABELS):
            session.add(
                Post(
                    title=f"{plan['title']} — {label}",
                    platform=plan["platform"],
                    scheduled_at=series_start + timedelta(days=pos),
                    status="scheduled",
                    body=plan["stage_bodies"][pos],
                    stage=label,
                    owner_id=alice.id,
                    series_id=series.id,
                    series_position=pos,
                )
            )

    # 2 standalone scheduled posts on platforms NOT used by the series
    # so the 15-min gap rule has nothing to argue with.
    standalone_scheduled = [
        {
            "title": "Quick tip thread",
            "platform": "twitter",
            "body": "Why I plan a week ahead in EST.",
            "offset_days": 1,
            "hour": 9,
        },
        {
            "title": "Behind-the-scenes shot",
            "platform": "instagram",
            "body": "Studio setup for the next drop.",
            "offset_days": 4,
            "hour": 17,
        },
    ]
    for spec in standalone_scheduled:
        when = base.replace(hour=spec["hour"]) + timedelta(days=spec["offset_days"])
        session.add(
            Post(
                title=spec["title"],
                platform=spec["platform"],
                scheduled_at=when,
                status="scheduled",
                body=spec["body"],
                owner_id=alice.id,
            )
        )

    # 2 draft posts — no scheduled_at, exempt from the gap rule.
    drafts = [
        {
            "title": "Idea: cross-platform launch checklist",
            "platform": "linkedin",
            "body": "Brain-dump for a future LinkedIn long-form post.",
        },
        {
            "title": "Outline: Q3 content calendar",
            "platform": "youtube",
            "body": "Rough sketch of the next quarter's themes.",
        },
    ]
    for spec in drafts:
        session.add(
            Post(
                title=spec["title"],
                platform=spec["platform"],
                scheduled_at=None,
                status="draft",
                body=spec["body"],
                owner_id=alice.id,
            )
        )

    session.commit()
    print(
        f"Seeded into {DB_PATH}: 3 users, alice has 2 series "
        f"(TikTok + YouTube, 8 stage posts) + 2 scheduled standalone posts "
        f"+ 2 drafts."
    )
    print(
        "Login: alice@example.com / password123 "
        "(bob@example.com and charlie@example.com are empty accounts.)"
    )
    session.close()


if __name__ == "__main__":
    main()
