import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_list_posts_empty(client: AsyncClient, auth_headers: dict):
    r = await client.get("/api/v1/posts", headers=auth_headers)
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_create_post(client: AsyncClient, auth_headers: dict):
    r = await client.post(
        "/api/v1/posts",
        headers=auth_headers,
        json={
            "title": "My first post",
            "platform": "youtube",
            "status": "draft",
        },
    )
    assert r.status_code == 201
    data = r.json()
    assert data["title"] == "My first post"
    assert data["platform"] == "youtube"
    assert data["status"] == "draft"
    assert "id" in data
    assert "owner_id" in data


@pytest.mark.asyncio
async def test_list_posts_returns_own(client: AsyncClient, auth_headers: dict):
    await client.post(
        "/api/v1/posts",
        headers=auth_headers,
        json={"title": "Post A", "platform": "instagram", "status": "draft"},
    )
    r = await client.get("/api/v1/posts", headers=auth_headers)
    assert r.status_code == 200
    posts = r.json()
    assert len(posts) == 1
    assert posts[0]["title"] == "Post A"


@pytest.mark.asyncio
async def test_get_post(client: AsyncClient, auth_headers: dict):
    create = await client.post(
        "/api/v1/posts",
        headers=auth_headers,
        json={"title": "Get me", "platform": "twitter", "status": "scheduled"},
    )
    post_id = create.json()["id"]
    r = await client.get(f"/api/v1/posts/{post_id}", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["title"] == "Get me"
    assert r.json()["platform"] == "twitter"


@pytest.mark.asyncio
async def test_update_post(client: AsyncClient, auth_headers: dict):
    create = await client.post(
        "/api/v1/posts",
        headers=auth_headers,
        json={"title": "Original", "platform": "youtube", "status": "draft"},
    )
    post_id = create.json()["id"]
    r = await client.patch(
        f"/api/v1/posts/{post_id}",
        headers=auth_headers,
        json={"title": "Updated title", "status": "scheduled"},
    )
    assert r.status_code == 200
    assert r.json()["title"] == "Updated title"
    assert r.json()["status"] == "scheduled"
    assert r.json()["platform"] == "youtube"


@pytest.mark.asyncio
async def test_delete_post(client: AsyncClient, auth_headers: dict):
    create = await client.post(
        "/api/v1/posts",
        headers=auth_headers,
        json={"title": "To delete", "platform": "tiktok", "status": "draft"},
    )
    post_id = create.json()["id"]
    r = await client.delete(f"/api/v1/posts/{post_id}", headers=auth_headers)
    assert r.status_code == 204
    get_r = await client.get(f"/api/v1/posts/{post_id}", headers=auth_headers)
    assert get_r.status_code == 404


@pytest.mark.asyncio
async def test_posts_require_auth(client: AsyncClient):
    r = await client.get("/api/v1/posts")
    assert r.status_code == 401

    r = await client.post(
        "/api/v1/posts",
        json={"title": "No auth", "platform": "youtube", "status": "draft"},
    )
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_get_post_404(client: AsyncClient, auth_headers: dict):
    r = await client.get("/api/v1/posts/99999", headers=auth_headers)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_filter_posts_by_status(client: AsyncClient, auth_headers: dict):
    await client.post(
        "/api/v1/posts",
        headers=auth_headers,
        json={"title": "Draft", "platform": "youtube", "status": "draft"},
    )
    await client.post(
        "/api/v1/posts",
        headers=auth_headers,
        json={"title": "Scheduled", "platform": "youtube", "status": "scheduled"},
    )
    r = await client.get("/api/v1/posts?status=draft", headers=auth_headers)
    assert r.status_code == 200
    posts = r.json()
    assert len(posts) == 1
    assert posts[0]["status"] == "draft"


# ============================================================
# 15-minute invariant enforcement on /api/posts (FR-008..FR-013)
# Added 2026-04-22 as part of 002-content-series US2 (test-first per
# Constitution Principle IX). These tests were committed FAILING before
# the invariant hook was wired into backend/app/api/posts.py.
# ============================================================


@pytest.mark.asyncio
async def test_create_rejects_within_15_min_same_platform(
    client: AsyncClient, auth_headers: dict
):
    await client.post(
        "/api/v1/posts",
        headers=auth_headers,
        json={
            "title": "First",
            "platform": "instagram",
            "status": "scheduled",
            "scheduled_at": "2026-05-01T09:00:00+00:00",
        },
    )
    r = await client.post(
        "/api/v1/posts",
        headers=auth_headers,
        json={
            "title": "Second (too close)",
            "platform": "instagram",
            "status": "scheduled",
            "scheduled_at": "2026-05-01T09:10:00+00:00",
        },
    )
    assert r.status_code == 409
    body = r.json()["detail"]
    assert body["error"] == "platform_gap_conflict"
    assert body["conflict_with_post_id"]
    assert body["conflict_with_scheduled_at"].startswith("2026-05-01T09:00:00")
    assert abs(body["delta_minutes"] + 10) < 0.5  # -10 min (other is before)


@pytest.mark.asyncio
async def test_create_accepts_exactly_15_min_same_platform(
    client: AsyncClient, auth_headers: dict
):
    """FR-009: strict-less-than boundary — exactly 15 min apart is accepted."""
    await client.post(
        "/api/v1/posts",
        headers=auth_headers,
        json={
            "title": "First",
            "platform": "instagram",
            "status": "scheduled",
            "scheduled_at": "2026-05-01T09:00:00+00:00",
        },
    )
    r = await client.post(
        "/api/v1/posts",
        headers=auth_headers,
        json={
            "title": "Second (exactly 15 min later)",
            "platform": "instagram",
            "status": "scheduled",
            "scheduled_at": "2026-05-01T09:15:00+00:00",
        },
    )
    assert r.status_code == 201


@pytest.mark.asyncio
async def test_create_accepts_same_time_different_platform(
    client: AsyncClient, auth_headers: dict
):
    await client.post(
        "/api/v1/posts",
        headers=auth_headers,
        json={
            "title": "Instagram",
            "platform": "instagram",
            "status": "scheduled",
            "scheduled_at": "2026-05-01T09:00:00+00:00",
        },
    )
    r = await client.post(
        "/api/v1/posts",
        headers=auth_headers,
        json={
            "title": "TikTok at same time",
            "platform": "tiktok",
            "status": "scheduled",
            "scheduled_at": "2026-05-01T09:00:00+00:00",
        },
    )
    assert r.status_code == 201


@pytest.mark.asyncio
async def test_patch_self_does_not_conflict(
    client: AsyncClient, auth_headers: dict
):
    """FR-013: PATCH excludes the post itself from the conflict set."""
    create = await client.post(
        "/api/v1/posts",
        headers=auth_headers,
        json={
            "title": "Original",
            "platform": "instagram",
            "status": "scheduled",
            "scheduled_at": "2026-05-01T09:00:00+00:00",
        },
    )
    post_id = create.json()["id"]
    r = await client.patch(
        f"/api/v1/posts/{post_id}",
        headers=auth_headers,
        json={"title": "Renamed"},
    )
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_patch_into_conflict_rejected(
    client: AsyncClient, auth_headers: dict
):
    a = await client.post(
        "/api/v1/posts",
        headers=auth_headers,
        json={
            "title": "A",
            "platform": "instagram",
            "status": "scheduled",
            "scheduled_at": "2026-05-01T09:00:00+00:00",
        },
    )
    b = await client.post(
        "/api/v1/posts",
        headers=auth_headers,
        json={
            "title": "B",
            "platform": "instagram",
            "status": "scheduled",
            "scheduled_at": "2026-05-01T10:00:00+00:00",
        },
    )
    # Move B into A's 15-min window.
    r = await client.patch(
        f"/api/v1/posts/{b.json()['id']}",
        headers=auth_headers,
        json={"scheduled_at": "2026-05-01T09:05:00+00:00"},
    )
    assert r.status_code == 409
    assert r.json()["detail"]["error"] == "platform_gap_conflict"


@pytest.mark.asyncio
async def test_draft_without_scheduled_at_always_accepted(
    client: AsyncClient, auth_headers: dict
):
    """FR-012: drafts (scheduled_at=None) bypass the invariant."""
    await client.post(
        "/api/v1/posts",
        headers=auth_headers,
        json={
            "title": "Scheduled",
            "platform": "instagram",
            "status": "scheduled",
            "scheduled_at": "2026-05-01T09:00:00+00:00",
        },
    )
    r = await client.post(
        "/api/v1/posts",
        headers=auth_headers,
        json={"title": "Draft", "platform": "instagram", "status": "draft"},
    )
    assert r.status_code == 201


# ============================================================
# FR-005a and FR-005b — series-membership immutability on PATCH
# (test-first per Principle IX). FR-005a is satisfied for free
# because PostUpdate excludes series_id/position; these tests guard
# against future regressions. FR-005b needs an explicit guard.
# ============================================================


@pytest.mark.asyncio
async def test_patch_does_not_mutate_series_id(
    client: AsyncClient, auth_headers: dict
):
    """FR-005a: PATCH with series_id in body must not change the field.

    PostUpdate doesn't declare series_id, so pydantic silently drops it.
    This test guards against a future regression that adds it.
    """
    create = await client.post(
        "/api/v1/posts",
        headers=auth_headers,
        json={
            "title": "standalone",
            "platform": "youtube",
            "status": "draft",
        },
    )
    post_id = create.json()["id"]
    assert create.json()["series_id"] is None

    r = await client.patch(
        f"/api/v1/posts/{post_id}",
        headers=auth_headers,
        json={"title": "renamed", "series_id": 999},
    )
    assert r.status_code == 200
    assert r.json()["series_id"] is None  # unchanged


@pytest.mark.asyncio
async def test_patch_allows_platform_change_on_standalone_post(
    client: AsyncClient, auth_headers: dict
):
    """Standalone posts (series_id IS NULL) can freely change platform."""
    create = await client.post(
        "/api/v1/posts",
        headers=auth_headers,
        json={
            "title": "standalone",
            "platform": "youtube",
            "status": "draft",
        },
    )
    post_id = create.json()["id"]
    r = await client.patch(
        f"/api/v1/posts/{post_id}",
        headers=auth_headers,
        json={"platform": "tiktok"},
    )
    assert r.status_code == 200
    assert r.json()["platform"] == "tiktok"


# NOTE (003 T026/T027): 002's `test_patch_rejects_platform_change_on_series_post`
# asserted that platform changes on series-child posts returned 400. That
# guard is REMOVED in 003 per FR-010 (Clarifications Plan-Q1 on multi-platform
# series). The replacement positive-path test lives below with name
# `test_patch_allows_platform_change_on_series_post`.


# ============================================================
# 003 Phase 5 — Post archive / unarchive (FR-015, T014)
# Test-first per Constitution Principle IX.
# ============================================================


async def _register_and_token(client: AsyncClient, email: str) -> dict:
    await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "pw", "full_name": email.split("@")[0]},
    )
    r = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": "pw"}
    )
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _create_simple_post(client, headers, **overrides):
    """Create a probe post. For statuses that the API no longer accepts
    on POST (published, failed — see FR-018 / 006 spec), the helper
    creates the post in `scheduled` first, then transitions it via the
    appropriate path (POST /publish for `published`, direct DB write
    for `failed` since `failed` has no client-facing route)."""
    target_status = overrides.pop("status", "scheduled")
    create_status = (
        target_status if target_status in ("draft", "scheduled", "archived")
        else "scheduled"
    )
    payload = {
        "title": "probe",
        "platform": "instagram",
        "status": create_status,
        "scheduled_at": "2026-05-01T09:00:00+00:00",
    }
    payload.update(overrides)
    r = await client.post("/api/v1/posts", headers=headers, json=payload)
    assert r.status_code == 201, r.text
    post = r.json()

    if target_status == "published":
        pr = await client.post(
            f"/api/v1/posts/{post['id']}/publish", headers=headers
        )
        assert pr.status_code == 200, pr.text
        return pr.json()
    if target_status == "failed":
        # No public path; `failed` is reserved for backend write only.
        from app.core.database import AsyncSessionLocal
        from app.models.post import Post
        from sqlalchemy import select
        async with AsyncSessionLocal() as db:
            target = (
                await db.execute(select(Post).where(Post.id == post["id"]))
            ).scalar_one()
            target.status = "failed"
            await db.commit()
        gr = await client.get(f"/api/v1/posts/{post['id']}", headers=headers)
        return gr.json()
    return post


@pytest.mark.asyncio
async def test_archive_post_happy_path_flips_status_and_sets_previous(
    client: AsyncClient, auth_headers: dict
):
    post = await _create_simple_post(client, auth_headers)
    r = await client.post(
        f"/api/v1/posts/{post['id']}/archive", headers=auth_headers
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "archived"
    assert body["previous_status"] == "scheduled"


@pytest.mark.asyncio
async def test_unarchive_post_lands_in_draft_and_clears_previous_status(
    client: AsyncClient, auth_headers: dict
):
    """Unarchive always restores to `draft` (006 contract) regardless of
    what the source status was before archive. Source-as-draft is the
    trivial case — assertion is identical to the prior test name."""
    post = await _create_simple_post(client, auth_headers, status="draft")
    await client.post(f"/api/v1/posts/{post['id']}/archive", headers=auth_headers)
    r = await client.post(
        f"/api/v1/posts/{post['id']}/unarchive", headers=auth_headers
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "draft"
    assert body["previous_status"] is None


@pytest.mark.asyncio
async def test_unarchive_scheduled_post_lands_in_draft_keeps_scheduled_at(
    client: AsyncClient, auth_headers: dict
):
    """A `scheduled` post archived then unarchived MUST land in `draft`
    (NOT back to `scheduled`) so the auto-publish loop is not silently
    re-armed for a post the user had explicitly removed. `scheduled_at`
    is preserved so they can review + flip back to scheduled by editing.
    """
    from datetime import datetime as _dt, timezone as _tz

    post = await _create_simple_post(
        client, auth_headers, status="scheduled",
        scheduled_at="2026-06-01T12:00:00+00:00",
    )

    def _to_utc(iso: str) -> _dt:
        parsed = _dt.fromisoformat(iso.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=_tz.utc)
        return parsed

    original_at = _to_utc(post["scheduled_at"])

    await client.post(f"/api/v1/posts/{post['id']}/archive", headers=auth_headers)
    r = await client.post(
        f"/api/v1/posts/{post['id']}/unarchive", headers=auth_headers
    )
    assert r.status_code == 200
    body = r.json()
    # Status flips to draft, NOT back to scheduled.
    assert body["status"] == "draft"
    # scheduled_at is preserved through the round trip.
    restored_at = _to_utc(body["scheduled_at"])
    assert restored_at == original_at, (
        f"scheduled_at drifted across archive round-trip: "
        f"{body['scheduled_at']!r} vs {post['scheduled_at']!r}"
    )
    assert body["previous_status"] is None


@pytest.mark.parametrize("source_status", ["draft", "scheduled", "published", "failed"])
@pytest.mark.asyncio
async def test_archive_preserves_source_status_in_previous_status(
    client: AsyncClient, auth_headers: dict, source_status: str
):
    """Any non-archived source status must be faithfully preserved."""
    post = await _create_simple_post(client, auth_headers, status=source_status)
    r = await client.post(
        f"/api/v1/posts/{post['id']}/archive", headers=auth_headers
    )
    assert r.status_code == 200
    assert r.json()["previous_status"] == source_status


@pytest.mark.asyncio
async def test_archive_already_archived_returns_409_already_archived(
    client: AsyncClient, auth_headers: dict
):
    post = await _create_simple_post(client, auth_headers)
    await client.post(f"/api/v1/posts/{post['id']}/archive", headers=auth_headers)
    r = await client.post(
        f"/api/v1/posts/{post['id']}/archive", headers=auth_headers
    )
    assert r.status_code == 409
    assert r.json()["detail"]["error"] == "already_archived"


@pytest.mark.asyncio
async def test_unarchive_not_archived_returns_409_not_archived(
    client: AsyncClient, auth_headers: dict
):
    post = await _create_simple_post(client, auth_headers)
    r = await client.post(
        f"/api/v1/posts/{post['id']}/unarchive", headers=auth_headers
    )
    assert r.status_code == 409
    assert r.json()["detail"]["error"] == "not_archived"


@pytest.mark.asyncio
async def test_archive_post_404_not_found(client: AsyncClient, auth_headers: dict):
    r = await client.post("/api/v1/posts/999999/archive", headers=auth_headers)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_unarchive_post_404_not_found(client: AsyncClient, auth_headers: dict):
    r = await client.post("/api/v1/posts/999999/unarchive", headers=auth_headers)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_archive_post_404_for_other_owner(
    client: AsyncClient, auth_headers: dict
):
    """FR-028 ownership scoping: archive endpoint must 404 (not 403) across owners."""
    alice_post = await _create_simple_post(client, auth_headers)
    bob = await _register_and_token(client, "bob-archive@example.com")
    r = await client.post(f"/api/v1/posts/{alice_post['id']}/archive", headers=bob)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_unarchive_post_404_for_other_owner(
    client: AsyncClient, auth_headers: dict
):
    alice_post = await _create_simple_post(client, auth_headers)
    await client.post(
        f"/api/v1/posts/{alice_post['id']}/archive", headers=auth_headers
    )
    bob = await _register_and_token(client, "bob-unarchive@example.com")
    r = await client.post(
        f"/api/v1/posts/{alice_post['id']}/unarchive", headers=bob
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_archive_post_requires_auth(client: AsyncClient):
    """401 when no Bearer token is attached."""
    r = await client.post("/api/v1/posts/1/archive")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_unarchive_post_requires_auth(client: AsyncClient):
    r = await client.post("/api/v1/posts/1/unarchive")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_archive_post_accepts_empty_body(
    client: AsyncClient, auth_headers: dict
):
    """Archive is a state transition — request body is ignored, not required."""
    post = await _create_simple_post(client, auth_headers)
    r = await client.post(
        f"/api/v1/posts/{post['id']}/archive",
        headers=auth_headers,
        content=b"",
    )
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_archive_frees_15min_slot_for_new_post(
    client: AsyncClient, auth_headers: dict
):
    """Integration: FR-018 archive-exclusion realized end-to-end — after
    archiving a post at T, a new post at T+5min on the same platform is
    accepted (previously it would 409)."""
    first = await _create_simple_post(
        client,
        auth_headers,
        scheduled_at="2026-05-01T09:00:00+00:00",
    )
    await client.post(f"/api/v1/posts/{first['id']}/archive", headers=auth_headers)
    r = await client.post(
        "/api/v1/posts",
        headers=auth_headers,
        json={
            "title": "replacement",
            "platform": "instagram",
            "status": "scheduled",
            "scheduled_at": "2026-05-01T09:05:00+00:00",
        },
    )
    assert r.status_code == 201, r.text


@pytest.mark.asyncio
async def test_unarchive_reenables_15min_blocking(
    client: AsyncClient, auth_headers: dict
):
    """Round-trip integrity: if post A is archived, a new post B is created
    in its slot, unarchiving A must NOT retroactively break B — but a
    *newly-proposed* post C in A's restored slot IS blocked by A again."""
    a = await _create_simple_post(
        client, auth_headers, scheduled_at="2026-07-01T09:00:00+00:00"
    )
    await client.post(f"/api/v1/posts/{a['id']}/archive", headers=auth_headers)
    b = await _create_simple_post(
        client, auth_headers, scheduled_at="2026-07-01T09:05:00+00:00"
    )
    # Unarchive A. A + B now share an owner+platform+~5-min overlap;
    # data integrity preserved (B is not retroactively deleted), but the
    # user can see the conflict in the list view. The unarchive endpoint
    # does NOT block on the fact that a new post slid into A's window —
    # this is a "best-effort restore" contract.
    unarchive_r = await client.post(
        f"/api/v1/posts/{a['id']}/unarchive", headers=auth_headers
    )
    assert unarchive_r.status_code == 200
    # 006 — unarchive always lands the post in `draft` regardless of
    # its source status. `scheduled_at` is preserved so the gap rule
    # still treats this row as a real time-claimer.
    assert unarchive_r.json()["status"] == "draft"
    # A new creation in A's 5-min window is now blocked again
    # (check_platform_gap excludes only `archived` posts; drafts with
    # non-null scheduled_at still count).
    blocked = await client.post(
        "/api/v1/posts",
        headers=auth_headers,
        json={
            "title": "late",
            "platform": "instagram",
            "status": "scheduled",
            "scheduled_at": "2026-07-01T09:10:00+00:00",
        },
    )
    assert blocked.status_code == 409


# ============================================================
# 003 Phase 5 — DELETE guard + include_archived query (FR-014, FR-025, T016)
# ============================================================


@pytest.mark.asyncio
async def test_delete_post_returns_409_for_published(
    client: AsyncClient, auth_headers: dict
):
    post = await _create_simple_post(client, auth_headers)
    # 006 — flip to published via the dedicated /publish endpoint
    # (PATCH no longer accepts status="published" per FR-018).
    pub = await client.post(
        f"/api/v1/posts/{post['id']}/publish", headers=auth_headers
    )
    assert pub.status_code == 200, pub.text
    r = await client.delete(f"/api/v1/posts/{post['id']}", headers=auth_headers)
    assert r.status_code == 409
    body = r.json()["detail"]
    assert body["error"] == "published_requires_archive"
    assert "published" in body["message"].lower()


@pytest.mark.parametrize("source_status", ["draft", "scheduled", "failed"])
@pytest.mark.asyncio
async def test_delete_post_returns_204_for_non_published_non_archived(
    client: AsyncClient, auth_headers: dict, source_status: str
):
    post = await _create_simple_post(client, auth_headers, status=source_status)
    r = await client.delete(f"/api/v1/posts/{post['id']}", headers=auth_headers)
    assert r.status_code == 204


@pytest.mark.asyncio
async def test_delete_archived_post_returns_204(
    client: AsyncClient, auth_headers: dict
):
    """Archiving a post is the soft state; hard-deleting an archived row
    is allowed (it removes history). Covered by data-model §7."""
    post = await _create_simple_post(client, auth_headers)
    await client.post(f"/api/v1/posts/{post['id']}/archive", headers=auth_headers)
    r = await client.delete(f"/api/v1/posts/{post['id']}", headers=auth_headers)
    assert r.status_code == 204


@pytest.mark.asyncio
async def test_delete_post_404_for_other_owner(
    client: AsyncClient, auth_headers: dict
):
    alice_post = await _create_simple_post(client, auth_headers)
    bob = await _register_and_token(client, "bob-delete@example.com")
    r = await client.delete(f"/api/v1/posts/{alice_post['id']}", headers=bob)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_list_posts_excludes_archived_by_default(
    client: AsyncClient, auth_headers: dict
):
    """FR-025: the list endpoint's default (param omitted) is include_archived=false."""
    p1 = await _create_simple_post(client, auth_headers, title="active-1")
    p2 = await _create_simple_post(
        client,
        auth_headers,
        title="active-2",
        scheduled_at="2026-05-01T10:00:00+00:00",
    )
    p3 = await _create_simple_post(
        client,
        auth_headers,
        title="to-archive",
        scheduled_at="2026-05-01T12:00:00+00:00",
    )
    await client.post(f"/api/v1/posts/{p3['id']}/archive", headers=auth_headers)
    r = await client.get("/api/v1/posts", headers=auth_headers)
    assert r.status_code == 200
    titles = {item["title"] for item in r.json()}
    assert titles == {"active-1", "active-2"}


@pytest.mark.asyncio
async def test_list_posts_with_include_archived_true_returns_archived(
    client: AsyncClient, auth_headers: dict
):
    p1 = await _create_simple_post(client, auth_headers, title="active")
    p2 = await _create_simple_post(
        client,
        auth_headers,
        title="archived",
        scheduled_at="2026-05-01T12:00:00+00:00",
    )
    await client.post(f"/api/v1/posts/{p2['id']}/archive", headers=auth_headers)
    r = await client.get(
        "/api/v1/posts?include_archived=true", headers=auth_headers
    )
    assert r.status_code == 200
    titles = {item["title"] for item in r.json()}
    assert titles == {"active", "archived"}


@pytest.mark.asyncio
async def test_list_posts_with_include_archived_false_excludes_archived(
    client: AsyncClient, auth_headers: dict
):
    """Explicit include_archived=false behaves the same as omission."""
    p1 = await _create_simple_post(client, auth_headers, title="active")
    p2 = await _create_simple_post(
        client,
        auth_headers,
        title="archived",
        scheduled_at="2026-05-01T12:00:00+00:00",
    )
    await client.post(f"/api/v1/posts/{p2['id']}/archive", headers=auth_headers)
    r = await client.get(
        "/api/v1/posts?include_archived=false", headers=auth_headers
    )
    assert r.status_code == 200
    titles = {item["title"] for item in r.json()}
    assert titles == {"active"}


@pytest.mark.asyncio
async def test_list_posts_include_archived_composes_with_status_filter(
    client: AsyncClient, auth_headers: dict
):
    """?include_archived=true&status=archived returns only archived rows."""
    p1 = await _create_simple_post(client, auth_headers, title="active")
    p2 = await _create_simple_post(
        client,
        auth_headers,
        title="archived-1",
        scheduled_at="2026-05-01T12:00:00+00:00",
    )
    p3 = await _create_simple_post(
        client,
        auth_headers,
        title="archived-2",
        scheduled_at="2026-05-02T12:00:00+00:00",
    )
    await client.post(f"/api/v1/posts/{p2['id']}/archive", headers=auth_headers)
    await client.post(f"/api/v1/posts/{p3['id']}/archive", headers=auth_headers)
    r = await client.get(
        "/api/v1/posts?include_archived=true&status=archived",
        headers=auth_headers,
    )
    assert r.status_code == 200
    titles = {item["title"] for item in r.json()}
    assert titles == {"archived-1", "archived-2"}


# ============================================================
# 003 Phase 8 — Post body + derived author (FR-008, FR-009, FR-027, T024)
# ============================================================


@pytest.mark.asyncio
async def test_create_post_with_body_round_trips(
    client: AsyncClient, auth_headers: dict
):
    post = await _create_simple_post(
        client, auth_headers, body="Teaser copy with emoji and unicode: café"
    )
    assert post["body"] == "Teaser copy with emoji and unicode: café"
    r = await client.get(f"/api/v1/posts/{post['id']}", headers=auth_headers)
    assert r.json()["body"] == "Teaser copy with emoji and unicode: café"


@pytest.mark.asyncio
async def test_patch_post_body_persists(
    client: AsyncClient, auth_headers: dict
):
    post = await _create_simple_post(client, auth_headers, body="original")
    r = await client.patch(
        f"/api/v1/posts/{post['id']}",
        headers=auth_headers,
        json={"body": "updated body"},
    )
    assert r.status_code == 200
    assert r.json()["body"] == "updated body"


@pytest.mark.asyncio
async def test_create_post_body_can_be_null(
    client: AsyncClient, auth_headers: dict
):
    """Body is optional; omitting it is fine."""
    r = await client.post(
        "/api/v1/posts",
        headers=auth_headers,
        json={
            "title": "no body",
            "platform": "youtube",
            "status": "draft",
        },
    )
    assert r.status_code == 201
    assert r.json()["body"] is None


@pytest.mark.asyncio
async def test_post_body_respects_max_length_5000_returns_422_at_5001(
    client: AsyncClient, auth_headers: dict
):
    too_long = "x" * 5001
    r = await client.post(
        "/api/v1/posts",
        headers=auth_headers,
        json={
            "title": "overflow",
            "platform": "youtube",
            "status": "draft",
            "body": too_long,
        },
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_post_body_accepts_exactly_5000_chars(
    client: AsyncClient, auth_headers: dict
):
    limit_body = "x" * 5000
    r = await client.post(
        "/api/v1/posts",
        headers=auth_headers,
        json={
            "title": "edge",
            "platform": "youtube",
            "status": "draft",
            "body": limit_body,
        },
    )
    assert r.status_code == 201
    assert len(r.json()["body"]) == 5000


@pytest.mark.asyncio
async def test_post_body_accepts_multiline_content(
    client: AsyncClient, auth_headers: dict
):
    multiline = "Line 1\n\nLine 3 with\ttabs\nAnd unicode ✓"
    post = await _create_simple_post(client, auth_headers, body=multiline)
    assert post["body"] == multiline


@pytest.mark.asyncio
async def test_post_response_includes_derived_author_from_owner_full_name(
    client: AsyncClient, auth_headers: dict
):
    """FR-009 / FR-027: author is derived at serialization time from owner.full_name."""
    post = await _create_simple_post(client, auth_headers)
    # auth_headers fixture registered "Test User".
    assert post["author"] == "Test User"


@pytest.mark.asyncio
async def test_post_response_falls_back_to_owner_email_when_full_name_is_null(
    client: AsyncClient
):
    """FR-009: if full_name is NULL, author falls back to email."""
    await client.post(
        "/api/v1/auth/register",
        json={
            "email": "noname@example.com",
            "password": "pw",
            # full_name intentionally omitted — stored as NULL
        },
    )
    r = await client.post(
        "/api/v1/auth/login",
        json={"email": "noname@example.com", "password": "pw"},
    )
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    post = await _create_simple_post(client, headers)
    assert post["author"] == "noname@example.com"


@pytest.mark.asyncio
async def test_list_posts_response_includes_derived_author(
    client: AsyncClient, auth_headers: dict
):
    """FR-027: author surfaces in list responses too, not just detail."""
    await _create_simple_post(client, auth_headers)
    r = await client.get("/api/v1/posts", headers=auth_headers)
    assert r.json()[0]["author"] == "Test User"


@pytest.mark.asyncio
async def test_different_owners_see_different_author_strings_on_their_posts(
    client: AsyncClient
):
    alice_h = await _register_and_token(client, "alice-author@example.com")
    bob_h = await _register_and_token(client, "bob-author@example.com")
    alice_post = await _create_simple_post(client, alice_h)
    bob_post = await _create_simple_post(
        client,
        bob_h,
        scheduled_at="2026-05-01T12:00:00+00:00",
    )
    # full_name defaults from the email local-part in _register_and_token.
    assert alice_post["author"] == "alice-author"
    assert bob_post["author"] == "bob-author"


# ============================================================
# 003 Phase 8 — PATCH series post: FR-005b removed + sequential integrity
# re-check on scheduled_at moves (FR-010, FR-020, T026)
# ============================================================


async def _create_4stage_series(client, auth_headers, *, base_time="2026-09-01T09:00:00+00:00"):
    """Helper: create a 4-stage series via the templated endpoint and
    return (series_id, posts_by_position)."""
    from datetime import datetime as _dt, timedelta as _td
    t0 = _dt.fromisoformat(base_time.replace("Z", "+00:00"))
    stages = [
        {
            "stage": label,
            "platform": "instagram",
            "title": f"{label} post",
            "body": f"{label} body",
            "scheduled_at": (t0 + _td(days=7 * i)).isoformat(),
        }
        for i, label in enumerate(["Teaser", "Announcement", "Follow-up", "Reminder"])
    ]
    r = await client.post(
        "/api/v1/series",
        headers=auth_headers,
        json={"title": "helper series", "description": "h", "stages": stages},
    )
    assert r.status_code == 201, r.text
    series = r.json()
    posts = sorted(series["posts"], key=lambda p: p["series_position"])
    return series["id"], posts


@pytest.mark.asyncio
async def test_patch_allows_platform_change_on_series_post(
    client: AsyncClient, auth_headers: dict
):
    """003 T027: FR-005b is REMOVED; platform change on series post allowed
    as long as the 15-min invariant on the new platform is clear.
    Rewrites 002's `test_patch_rejects_platform_change_on_series_post`."""
    _sid, posts = await _create_4stage_series(client, auth_headers)
    teaser = posts[0]
    r = await client.patch(
        f"/api/v1/posts/{teaser['id']}",
        headers=auth_headers,
        json={"platform": "twitter"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["platform"] == "twitter"


@pytest.mark.asyncio
async def test_patch_series_post_platform_change_rechecks_15min_on_new_platform(
    client: AsyncClient, auth_headers: dict
):
    """FR-018 + FR-019: changing a series post's platform triggers the
    15-min check on the new platform."""
    _sid, posts = await _create_4stage_series(client, auth_headers)
    teaser = posts[0]
    # Seed a twitter post 5 min after teaser — blocks the move to twitter.
    from datetime import datetime as _dt, timedelta as _td
    t = _dt.fromisoformat(teaser["scheduled_at"].replace("Z", "+00:00"))
    await client.post(
        "/api/v1/posts",
        headers=auth_headers,
        json={
            "title": "twitter neighbor",
            "platform": "twitter",
            "status": "scheduled",
            "scheduled_at": (t + _td(minutes=5)).isoformat(),
        },
    )
    r = await client.patch(
        f"/api/v1/posts/{teaser['id']}",
        headers=auth_headers,
        json={"platform": "twitter"},
    )
    assert r.status_code == 409
    assert r.json()["detail"]["error"] == "platform_gap_conflict"


@pytest.mark.asyncio
async def test_patch_series_post_scheduled_at_breaks_sequential_integrity_returns_409(
    client: AsyncClient, auth_headers: dict
):
    """FR-020 enforcement on PATCH: moving stage 2 BEFORE stage 1 rejects."""
    _sid, posts = await _create_4stage_series(client, auth_headers)
    # Move "Follow-up" (position 2) to before Announcement (position 1).
    from datetime import datetime as _dt, timedelta as _td
    announcement_t = _dt.fromisoformat(
        posts[1]["scheduled_at"].replace("Z", "+00:00")
    )
    new_t = (announcement_t - _td(hours=2)).isoformat()
    r = await client.patch(
        f"/api/v1/posts/{posts[2]['id']}",
        headers=auth_headers,
        json={"scheduled_at": new_t},
    )
    assert r.status_code == 409, r.text
    body = r.json()["detail"]
    assert body["error"] == "sequential_integrity_violation"
    assert "offending_post_index" in body
    assert "prior_post_index" in body


@pytest.mark.asyncio
async def test_patch_series_post_scheduled_at_preserves_sequential_integrity_returns_200(
    client: AsyncClient, auth_headers: dict
):
    """Moving stage 2 forward WITHIN its allowed window succeeds."""
    _sid, posts = await _create_4stage_series(client, auth_headers)
    # Move Follow-up (position 2) 1 hour later — still between Announcement
    # and Reminder in time. Ordering preserved.
    from datetime import datetime as _dt, timedelta as _td
    current = _dt.fromisoformat(posts[2]["scheduled_at"].replace("Z", "+00:00"))
    new_t = (current + _td(hours=1)).isoformat()
    r = await client.patch(
        f"/api/v1/posts/{posts[2]['id']}",
        headers=auth_headers,
        json={"scheduled_at": new_t},
    )
    assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_patch_series_post_moving_past_next_sibling_rejects(
    client: AsyncClient, auth_headers: dict
):
    """Moving stage 1 PAST stage 2's time triggers Sequential Integrity."""
    _sid, posts = await _create_4stage_series(client, auth_headers)
    # Move Announcement (1) past Follow-up's (2) time.
    from datetime import datetime as _dt, timedelta as _td
    followup_t = _dt.fromisoformat(posts[2]["scheduled_at"].replace("Z", "+00:00"))
    new_t = (followup_t + _td(hours=1)).isoformat()
    r = await client.patch(
        f"/api/v1/posts/{posts[1]['id']}",
        headers=auth_headers,
        json={"scheduled_at": new_t},
    )
    assert r.status_code == 409
    assert r.json()["detail"]["error"] == "sequential_integrity_violation"


@pytest.mark.asyncio
async def test_patch_series_post_body_change_does_not_trigger_scheduling_recheck(
    client: AsyncClient, auth_headers: dict
):
    """Editing only body/title MUST NOT re-run the 15-min or seq-integrity
    checks (no scheduled_at or platform in the patch)."""
    _sid, posts = await _create_4stage_series(client, auth_headers)
    r = await client.patch(
        f"/api/v1/posts/{posts[1]['id']}",
        headers=auth_headers,
        json={"body": "updated announcement body"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["body"] == "updated announcement body"


@pytest.mark.asyncio
async def test_patch_standalone_post_scheduled_at_does_not_check_seq_integrity(
    client: AsyncClient, auth_headers: dict
):
    """A standalone post (series_id NULL) must not trigger Sequential
    Integrity — only 15-min still applies."""
    post = await _create_simple_post(
        client, auth_headers, scheduled_at="2026-11-01T09:00:00+00:00"
    )
    r = await client.patch(
        f"/api/v1/posts/{post['id']}",
        headers=auth_headers,
        json={"scheduled_at": "2026-11-02T09:00:00+00:00"},
    )
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_patch_series_teaser_earliest_position_moving_later_ok(
    client: AsyncClient, auth_headers: dict
):
    """Moving the Teaser (position 0) LATER is fine as long as it stays
    earlier than Announcement."""
    _sid, posts = await _create_4stage_series(client, auth_headers)
    from datetime import datetime as _dt, timedelta as _td
    teaser_t = _dt.fromisoformat(posts[0]["scheduled_at"].replace("Z", "+00:00"))
    new_t = (teaser_t + _td(days=1)).isoformat()
    r = await client.patch(
        f"/api/v1/posts/{posts[0]['id']}",
        headers=auth_headers,
        json={"scheduled_at": new_t},
    )
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_patch_series_reminder_last_position_moving_later_always_ok(
    client: AsyncClient, auth_headers: dict
):
    """Position 3 (Reminder) has no successor — moving later cannot violate
    Sequential Integrity."""
    _sid, posts = await _create_4stage_series(client, auth_headers)
    from datetime import datetime as _dt, timedelta as _td
    reminder_t = _dt.fromisoformat(posts[3]["scheduled_at"].replace("Z", "+00:00"))
    new_t = (reminder_t + _td(days=30)).isoformat()
    r = await client.patch(
        f"/api/v1/posts/{posts[3]['id']}",
        headers=auth_headers,
        json={"scheduled_at": new_t},
    )
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_patch_series_reminder_moving_earlier_than_followup_rejects(
    client: AsyncClient, auth_headers: dict
):
    """But moving Reminder (last) BEFORE Follow-up (3rd) breaks ordering."""
    _sid, posts = await _create_4stage_series(client, auth_headers)
    from datetime import datetime as _dt, timedelta as _td
    followup_t = _dt.fromisoformat(posts[2]["scheduled_at"].replace("Z", "+00:00"))
    new_t = (followup_t - _td(hours=1)).isoformat()
    r = await client.patch(
        f"/api/v1/posts/{posts[3]['id']}",
        headers=auth_headers,
        json={"scheduled_at": new_t},
    )
    assert r.status_code == 409
    assert r.json()["detail"]["error"] == "sequential_integrity_violation"


# ============================================================
# 006 Phase 5 — Status transition lockdown (FR-016 / FR-017 / FR-018)
# ============================================================


@pytest.mark.asyncio
async def test_create_post_rejects_published_status(
    client: AsyncClient, auth_headers: dict
):
    """FR-018 — clients cannot self-promote a new post to `published`."""
    r = await client.post(
        "/api/v1/posts",
        headers=auth_headers,
        json={
            "title": "naughty",
            "platform": "instagram",
            "status": "published",
            "scheduled_at": "2026-05-01T09:00:00+00:00",
        },
    )
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert any(
        item.get("loc", [None, None])[-1] == "status"
        and "literal" in (item.get("type") or "").lower()
        for item in detail
    )


@pytest.mark.asyncio
async def test_create_post_rejects_failed_status(
    client: AsyncClient, auth_headers: dict
):
    """FR-019 — clients cannot mark a new post as `failed`."""
    r = await client.post(
        "/api/v1/posts",
        headers=auth_headers,
        json={
            "title": "naughty",
            "platform": "instagram",
            "status": "failed",
            "scheduled_at": "2026-05-01T09:00:00+00:00",
        },
    )
    assert r.status_code == 422


@pytest.mark.parametrize("source_status", ["draft", "scheduled", "archived"])
@pytest.mark.asyncio
async def test_create_post_accepts_user_settable_statuses(
    client: AsyncClient, auth_headers: dict, source_status: str
):
    """Regression — the three user-settable statuses still work on POST."""
    r = await client.post(
        "/api/v1/posts",
        headers=auth_headers,
        json={
            "title": "ok",
            "platform": "instagram",
            "status": source_status,
            "scheduled_at": "2026-05-01T09:00:00+00:00",
        },
    )
    assert r.status_code == 201, r.text


@pytest.mark.asyncio
async def test_patch_post_rejects_published_status(
    client: AsyncClient, auth_headers: dict
):
    post = await _create_simple_post(client, auth_headers)
    r = await client.patch(
        f"/api/v1/posts/{post['id']}",
        headers=auth_headers,
        json={"status": "published"},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_patch_post_rejects_failed_status(
    client: AsyncClient, auth_headers: dict
):
    post = await _create_simple_post(client, auth_headers)
    r = await client.patch(
        f"/api/v1/posts/{post['id']}",
        headers=auth_headers,
        json={"status": "failed"},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_get_post_response_includes_failure_annotation_fields(
    client: AsyncClient, auth_headers: dict
):
    """FR-007a / Phase 2 schema — every PostResponse includes the two
    annotation fields, defaulting to null on a freshly-created post."""
    post = await _create_simple_post(client, auth_headers)
    r = await client.get(f"/api/v1/posts/{post['id']}", headers=auth_headers)
    assert r.status_code == 200
    data = r.json()
    assert "last_publish_attempt_at" in data
    assert "last_publish_error" in data
    assert data["last_publish_attempt_at"] is None
    assert data["last_publish_error"] is None
