# Quickstart: Content Series

**Feature**: `specs/002-content-series`
**Audience**: developer or reviewer picking up this branch.

## Prerequisites

- The `001-docker-compose` stack works on your machine
  (`docker compose up` boots the app).
- You are on branch `002-content-series`.

## Spin up and verify

```sh
docker compose up                # (or the non-Docker venv path)
```

No DB reset required: the idempotent `ALTER TABLE` in `init_db()` adds the
two new `posts` columns on first startup and creates the new `series`
table. Subsequent starts are no-ops.

Open the app and log in as `alice@example.com` / `password123`.

## Create your first series (UI)

1. Click **Series** in the top nav (new link).
2. Click **New series**.
3. Fill the form:
   - Title: "Spring launch"
   - Platform: Instagram
   - Start at: pick a date ~7 days out, 09:00
   - Cadence: Every `1` `weeks`
   - Post count: `4`
4. The form shows a **live preview** of the four computed timestamps.
5. Submit.
6. You land on the series detail page showing the 4 generated posts.
7. Click into `Posts` in the nav — the same 4 posts are listed with a
   "Series #{id}" badge.
8. Click **Calendar** — the same 4 posts appear as events.

## Trigger the 15-min rule

1. Create a single post (via **New post**) on Instagram at, say,
   `2026-05-01T09:05:00Z`.
2. Create a series on Instagram starting `2026-05-01T09:00:00Z`, weekly, 4
   posts. The first generated timestamp is inside the 15-min window of
   the existing post.
3. Submit the series form. You get a 409 error toast identifying the
   conflict (post id, delta in minutes, which generated position
   collided). **No series row or posts are persisted.**
4. Bump the series `start_at` to `2026-05-01T09:20:00Z`. Resubmit.
   Series is created (first post is > 15 min after the conflict).

## Reproduce in CI

The existing four CI jobs (`backend-tests`, `frontend-tests`,
`frontend-lint`, `compose-build`) automatically cover this feature:

- `backend-tests` picks up `test_posts.py` (with the new invariant cases)
  and the new `test_scheduling.py` / `test_series.py`.
- `compose-build` re-validates the Dockerfiles and compose file.

Nothing to reconfigure.

## Reset (optional)

Only needed if you want a truly clean slate:

```sh
docker compose down
rm -f backend/scheduler.db
docker compose up
```

The entrypoint re-seeds. Your series are gone; seeded data is back.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| "Posts table missing `series_id` column" on first request | You ran the app before `init_db()` completed | Restart — the migration is idempotent |
| 409 on every series submit with identical times | Prior tests left posts at those slots | Delete conflicting posts or `rm backend/scheduler.db` + restart |
| Empty Series page after creating one | Browser cached an old list; ProtectedRoute re-auth happened | Hard refresh (Cmd-Shift-R) |
| Hot reload didn't pick up `series.py` | File wasn't under `backend/app/` when saved | Confirm path: `backend/app/api/series.py` — uvicorn only watches `app/` |
