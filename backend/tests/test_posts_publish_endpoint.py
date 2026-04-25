"""Tests for POST /api/v1/posts/{id}/publish (feature 006, US2).

Test-First per Principle IX. Covers FR-010 through FR-015b plus
SC-002 / SC-005. See specs/006-auto-publish-flow/contracts/publish-endpoint.md.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.core.security import get_password_hash
from app.models.post import Post
from app.models.series import Series
from app.models.user import User


UTC = timezone.utc


def _fut(seconds: int = 60) -> datetime:
    return datetime.now(UTC) + timedelta(seconds=seconds)


async def _create_post_via_api(client, headers, **overrides) -> dict:
    body = {
        "title": "T",
        "platform": "instagram",
        "scheduled_at": _fut().isoformat(),
        "status": "scheduled",
    }
    body.update(overrides)
    r = await client.post("/api/v1/posts", json=body, headers=headers)
    assert r.status_code in (200, 201), r.text
    return r.json()


async def _seed_series_with_stages(owner_id: int, *, platform: str = "instagram") -> Series:
    """Insert a Series + 2 child Posts (positions 0 and 1) directly via DB.
    Used by tests that need controlled series state without going through
    the templated 4-stage create endpoint."""
    async with AsyncSessionLocal() as db:
        s = Series(
            title="Drop",
            description=None,
            platform=platform,
            owner_id=owner_id,
            start_at=datetime(2026, 5, 1, 13, 0, tzinfo=UTC),
            cadence_unit="days",
            cadence_interval=1,
            post_count=4,
        )
        db.add(s)
        await db.flush()
        s.family_id = s.id
        # stage 0 in the past — simulates the "predecessor not yet published" case
        p0 = Post(
            title="Teaser",
            platform=platform,
            scheduled_at=datetime.now(UTC) - timedelta(hours=1),
            status="scheduled",
            owner_id=owner_id,
            series_id=s.id,
            series_position=0,
        )
        # stage 1 a fair bit later so the 15-min platform gap rule is happy
        p1 = Post(
            title="Announce",
            platform=platform,
            scheduled_at=datetime.now(UTC) + timedelta(hours=2),
            status="scheduled",
            owner_id=owner_id,
            series_id=s.id,
            series_position=1,
        )
        db.add_all([p0, p1])
        await db.commit()
        await db.refresh(s)
        return s


# ─────────────────────────────────────────────────────────────────────────
# T020 — happy path from scheduled
# ─────────────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_publish_scheduled_post_succeeds(client, auth_headers):
    post = await _create_post_via_api(client, auth_headers)
    r = await client.post(
        f"/api/v1/posts/{post['id']}/publish", headers=auth_headers
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["status"] == "published"
    assert data["last_publish_attempt_at"] is None
    assert data["last_publish_error"] is None


# ─────────────────────────────────────────────────────────────────────────
# T021 — happy path from draft (no scheduled_at)
# ─────────────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_publish_draft_post_succeeds(client, auth_headers):
    post = await _create_post_via_api(
        client, auth_headers, status="draft", scheduled_at=None
    )
    r = await client.post(
        f"/api/v1/posts/{post['id']}/publish", headers=auth_headers
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "published"


# ─────────────────────────────────────────────────────────────────────────
# T022 — manual publish bypasses sequential rule (FR-015a)
# ─────────────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_publish_bypasses_sequential_rule(client, auth_headers):
    # Register and login to get owner_id from the JWT subject claim. We
    # already have headers, but we need the owner_id to seed via DB. Look
    # the user up.
    async with AsyncSessionLocal() as db:
        owner = (await db.execute(select(User))).scalar_one()
    s = await _seed_series_with_stages(owner.id)
    # Find stage 1 (series_position=1)
    async with AsyncSessionLocal() as db:
        stage1 = (
            await db.execute(
                select(Post).where(
                    Post.series_id == s.id, Post.series_position == 1
                )
            )
        ).scalar_one()
        stage1_id = stage1.id
    r = await client.post(
        f"/api/v1/posts/{stage1_id}/publish", headers=auth_headers
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "published"
    # Verify stage 0 was NOT touched.
    async with AsyncSessionLocal() as db:
        stage0 = (
            await db.execute(
                select(Post).where(
                    Post.series_id == s.id, Post.series_position == 0
                )
            )
        ).scalar_one()
        assert stage0.status == "scheduled"


# ─────────────────────────────────────────────────────────────────────────
# T023 — auth failure
# ─────────────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_publish_unauthenticated_returns_401(client, auth_headers):
    post = await _create_post_via_api(client, auth_headers)
    r = await client.post(f"/api/v1/posts/{post['id']}/publish")
    assert r.status_code == 401


# ─────────────────────────────────────────────────────────────────────────
# T024 — wrong owner returns 404 (identity-leak rule)
# ─────────────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_publish_other_owners_post_returns_404(client, auth_headers):
    # Create alice's post first.
    post = await _create_post_via_api(client, auth_headers)
    # Register a second user, log in.
    await client.post(
        "/api/v1/auth/register",
        json={"email": "bob@test.com", "password": "pw", "full_name": "Bob"},
    )
    bob_login = await client.post(
        "/api/v1/auth/login",
        json={"email": "bob@test.com", "password": "pw"},
    )
    bob_headers = {"Authorization": f"Bearer {bob_login.json()['access_token']}"}
    r = await client.post(
        f"/api/v1/posts/{post['id']}/publish", headers=bob_headers
    )
    assert r.status_code == 404


# ─────────────────────────────────────────────────────────────────────────
# T025 — terminal status sources are 409
# ─────────────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_publish_archived_returns_409(client, auth_headers):
    post = await _create_post_via_api(client, auth_headers)
    arch = await client.post(
        f"/api/v1/posts/{post['id']}/archive", headers=auth_headers
    )
    assert arch.status_code in (200, 201)
    r = await client.post(
        f"/api/v1/posts/{post['id']}/publish", headers=auth_headers
    )
    assert r.status_code == 409
    body = r.json()
    detail = body.get("detail") or body
    if isinstance(detail, dict):
        assert detail.get("error") == "publish_not_allowed"


@pytest.mark.asyncio
async def test_publish_failed_status_returns_409(client, auth_headers):
    post = await _create_post_via_api(client, auth_headers)
    # Seed a `failed` status directly via DB (clients can't set it).
    async with AsyncSessionLocal() as db:
        target = (
            await db.execute(select(Post).where(Post.id == post["id"]))
        ).scalar_one()
        target.status = "failed"
        await db.commit()
    r = await client.post(
        f"/api/v1/posts/{post['id']}/publish", headers=auth_headers
    )
    assert r.status_code == 409


# ─────────────────────────────────────────────────────────────────────────
# T026 — already-published is idempotent (200 or 409 acceptable)
# ─────────────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_publish_already_published_is_idempotent(client, auth_headers):
    post = await _create_post_via_api(client, auth_headers)
    r1 = await client.post(
        f"/api/v1/posts/{post['id']}/publish", headers=auth_headers
    )
    assert r1.status_code == 200
    r2 = await client.post(
        f"/api/v1/posts/{post['id']}/publish", headers=auth_headers
    )
    assert r2.status_code in (200, 409), r2.text
    # Either way, the post must remain published.
    async with AsyncSessionLocal() as db:
        target = (
            await db.execute(select(Post).where(Post.id == post["id"]))
        ).scalar_one()
        assert target.status == "published"


# ─────────────────────────────────────────────────────────────────────────
# T027 — publishing clears any prior failure annotation (FR-007b)
# ─────────────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_publish_clears_existing_failure_annotation(client, auth_headers):
    post = await _create_post_via_api(client, auth_headers)
    async with AsyncSessionLocal() as db:
        target = (
            await db.execute(select(Post).where(Post.id == post["id"]))
        ).scalar_one()
        target.last_publish_attempt_at = datetime.now(UTC)
        target.last_publish_error = "transient_database_error"
        await db.commit()

    r = await client.post(
        f"/api/v1/posts/{post['id']}/publish", headers=auth_headers
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["status"] == "published"
    assert data["last_publish_attempt_at"] is None
    assert data["last_publish_error"] is None
