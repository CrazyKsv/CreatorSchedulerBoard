#!/usr/bin/env python3
"""
Seed the local SQLite database with random users and posts for visualization.
Run from repo root: python backend/scripts/seed_data.py
Or from backend: python scripts/seed_data.py
"""
import random
import sys
from datetime import datetime, timedelta
from pathlib import Path

# Add backend to path so we can import app
backend = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.core.security import get_password_hash
from app.models.user import User
from app.models.post import Post
from app.core.database import Base

# Use sync SQLite for script (same DB file as async app)
DB_PATH = backend / "scheduler.db"
DATABASE_URL = f"sqlite:///{DB_PATH}"

PLATFORMS = ["youtube", "instagram", "twitter", "tiktok", "linkedin"]
STATUSES = ["draft", "scheduled", "published", "failed"]
TITLE_PREFIXES = [
    "How to", "My take on", "Quick tip:", "Behind the scenes", "Launch day",
    "Tutorial:", "Update", "Announcement", "Week in review", "Deep dive",
]
TITLE_SUFFIXES = [
    "for beginners", "that changed everything", "you need to see", "thread",
    "video", "post", "story", "short", "live", "recap",
]


def main():
    engine = create_engine(DATABASE_URL, echo=False)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()

    # Create seed users (password: password123)
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
            user = User(email=u["email"], hashed_password=hashed, full_name=u["full_name"])
            session.add(user)
            session.commit()
            session.refresh(user)
            users.append(user)

    # Create random posts for each user
    now = datetime.utcnow()
    for user in users:
        n_posts = random.randint(5, 15)
        for _ in range(n_posts):
            title = f"{random.choice(TITLE_PREFIXES)} {random.choice(TITLE_SUFFIXES)}"
            platform = random.choice(PLATFORMS)
            status = random.choice(STATUSES)
            # Spread scheduled_at across past 7 days and next 14 days
            days = random.randint(-7, 14)
            hour = random.randint(8, 20)
            scheduled_at = (now + timedelta(days=days)).replace(hour=hour, minute=random.choice([0, 15, 30, 45]), second=0, microsecond=0) if status in ("scheduled", "published") else None
            if status == "draft":
                scheduled_at = None
            post = Post(
                title=title,
                platform=platform,
                scheduled_at=scheduled_at,
                status=status,
                owner_id=user.id,
            )
            session.add(post)
    session.commit()
    print(f"Seeded {len(users)} users and posts into {DB_PATH}")
    print("Login with: alice@example.com / password123 (or bob@example.com, charlie@example.com)")
    session.close()


if __name__ == "__main__":
    main()
