# Quickstart: Content Management (003 upgrade)

**Feature**: `specs/003-content-management`
**Audience**: developer / reviewer picking up this branch.

## Prerequisites

- The `001-docker-compose` stack works locally.
- You are on branch `003-content-management`.
- Existing `backend/scheduler.db` from 002 is fine — you do NOT need to reset it.

## Spin up

```sh
cd frontend && npm install     # picks up tailwindcss + lucide-react
cd ..
docker compose up
```

On backend first-boot the idempotent `ALTER TABLE` block adds the new
columns (4 on `posts`, 2 on `series`) if they are missing. Subsequent
boots are no-ops.

## Try the upgraded flow

1. Open `http://localhost:5173` and log in as `alice@example.com` / `password123`.
2. The root page is the new **Dashboard** (TopNav + ListView + CalendarView).
3. Click **New series**:
   - The template is locked to the 4 stages (Teaser / Announcement / Follow-up / Reminder).
   - Stage labels are read-only (lock icon visible).
   - 15-minute rule reminder banner pinned at the top of the modal.
   - Fill each stage — pick platform, title, body, date + time.
   - Submit. If any stage is out of order (Sequential Integrity) or within 15 min of another same-platform post, submit is blocked with the offending stage highlighted.
4. The new series appears in ListView; its 4 posts appear as events in CalendarView.
5. Click an individual post to edit its title, body, platform, scheduled time — all allowed (FR-005b no longer applies to series posts). The 15-min rule still fires.

## Try archive / unarchive

### Post

1. Change a scheduled post's status to `published` (set it via the edit form or `PATCH /api/v1/posts/{id}`).
2. Try to delete it — the DELETE is rejected with 409 `published_requires_archive`. The UI swaps the menu to **Archive** instead.
3. Click Archive — the post's `status` becomes `archived`, row fades in the ListView.
4. Calendar no longer shows it (hidden by default).
5. Click the Unarchive icon on the faded row — status restores to `published`.

### Series

1. Create a series, then mark at least one of its posts as `published`.
2. Click **Delete series** on the card — 409 `series_has_published_posts`. The UI swaps to **Archive Series**.
3. Click Archive Series — the series + all its posts flip to `archived`.
4. Unarchive restores them.

## Key URLs

| What | URL |
|---|---|
| Dashboard (List + Calendar) | `http://localhost:5173/` |
| Backend Swagger | `http://localhost:8000/docs` |
| Templated series create | `POST http://localhost:8000/api/v1/series` |
| Post archive / unarchive | `POST .../api/v1/posts/{id}/(un)archive` |
| Series archive / unarchive | `POST .../api/v1/series/{id}/(un)archive` |
| List with archived | `GET .../api/v1/posts?include_archived=true` |

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Tailwind classes don't apply | `npm install` hasn't run after the package.json bump, or `postcss.config.js` missing | Run `npm install` in `frontend/`; confirm `postcss.config.js` exists |
| 500 on series create complaining about missing column | Backend started against a pre-migration DB (races) | Restart backend — `init_db` re-runs on every boot |
| 15-min conflict where the blocker is archived | Cached response; shouldn't happen — invariant now excludes archived | Hard-refresh the page; re-check the query in `scheduling.py` |
| Archive button missing on a published post | UI may be showing a stale 002 route | Clear localStorage and reload; the Dashboard should render |

## See also

- [`spec.md`](./spec.md) — all 13 Clarifications
- [`plan.md`](./plan.md) — implementation plan
- [`data-model.md`](./data-model.md) — schema deltas + pseudocode
- [`contracts/`](./contracts/) — endpoint + invariant contracts
- [`high-level-design.md`](./high-level-design.md) — mermaid diagrams
