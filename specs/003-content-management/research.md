# Phase 0 Research: Content Management (003 upgrade)

**Feature**: `specs/003-content-management`
**Date**: 2026-04-22

All decisions below were resolved during `/speckit-specify` (8 pre-spec
questions Q1–Q8), `/speckit-clarify` (5 questions Clarify-Q1 through
Q5), or derived during this plan's design pass. Zero open questions.

## 1. Archive visibility per view

**Decision**: each list-style endpoint accepts `include_archived=true|false`.
Default is `false`. The ported ListView sends `true`; CalendarView
sends `false`.

**Source**: Clarify-Q4.

**Implementation**: one parameter on `GET /api/v1/posts` and
`GET /api/v1/series`. Internally, the `WHERE status != 'archived'` clause
is conditional. No separate endpoint.

## 2. Archive / unarchive state machine

**Decision**: archiving sets `previous_status = current status`, then
`status = 'archived'`. Unarchiving restores `status = previous_status`
and nulls `previous_status`. Enforced for both posts and series.

**Source**: Clarify-Q5 (from pre-spec) + derived.

**Edge cases**:
- Double-archive: rejected with 4xx (idempotent guard — nothing to do).
- Unarchive on a non-archived item: rejected with 4xx.
- Unarchive when `previous_status` is null: should not occur; treated
  as a 500 / invariant violation (logged but not user-visible).

## 3. Series-create request shape

**Decision**: one request carries 4 stage payloads. Each stage:
`{ stage, platform, title, body, scheduled_at }`. Server validates
Teaser → Announcement → Follow-up → Reminder order at position
0..3 (fixed; rejected if the client sends anything else). One
transaction: insert `Series` row, flush for id, insert 4 `Post` rows
each with `stage` and `series_position`.

**Endpoint**: `POST /api/v1/series` (the 002 cadence-based body is
RETIRED — there is no separate `/api/v1/series/v2`; the versioned
path hosts the new 4-stage shape directly). See §11 for the versioning
rationale.

**Source**: Clarify-Q7 (pre-spec) + user re-plan directive at
`/speckit-plan` time.

**Request pseudocode**:

```json
POST /api/v1/series
{
  "name": "Spring Launch",
  "description": "...",
  "stages": [
    { "stage": "Teaser",       "platform": "instagram", "title": "...", "body": "...", "scheduled_at": "2026-05-01T09:00:00Z" },
    { "stage": "Announcement", "platform": "twitter",   "title": "...", "body": "...", "scheduled_at": "2026-05-02T10:00:00Z" },
    { "stage": "Follow-up",    "platform": "linkedin",  "title": "...", "body": "...", "scheduled_at": "2026-05-05T11:00:00Z" },
    { "stage": "Reminder",     "platform": "instagram", "title": "...", "body": "...", "scheduled_at": "2026-05-08T12:00:00Z" }
  ]
}
```

Server enforces `stages[i].stage == ["Teaser","Announcement","Follow-up","Reminder"][i]`
at the Pydantic layer (Literal enum; rejected with 422 if mismatched).

## 4. `check_sequential_integrity` function shape

**Decision**: pure async function, same location as
`check_platform_gap` (`backend/app/core/scheduling.py`). Takes
`[datetime]` in position order; returns `Optional[SeqConflict]` with
`offending_index`, `prior_index`, `offending_at`, `prior_at`.
Short-circuits on first violation.

Pseudocode:

```python
@dataclass(frozen=True)
class SeqConflict:
    offending_index: int
    prior_index: int
    offending_at: datetime
    prior_at: datetime
    @property
    def human_message(self) -> str: ...

def check_sequential_integrity(times: list[datetime]) -> Optional[SeqConflict]:
    for i in range(1, len(times)):
        if times[i] <= times[i - 1]:
            return SeqConflict(i, i - 1, times[i], times[i - 1])
    return None
```

Called by `POST /api/v1/series` (all four times) and
`PATCH /api/v1/posts/{id}` (when the post belongs to a series — compute
the series' post times with the candidate swapped in, then check).

## 5. Status enum migration strategy

**Decision**: SQLite stores status as a string (already the case in
002). Adding `'archived'` requires no schema change — the column
already accepts any string. The expanded enum is enforced at the
Pydantic/application layer via `Literal`. Running the 002 DB against
the upgraded code "just works" for the enum dimension.

**Source**: existing `posts.status` column is `String(32)`; SQLAlchemy
stores the enum as text, not an enum type.

## 6. CCM → Vite port strategy

**Decision**: component-by-component port.

- **Inputs**: read CCM jsx file, remove `const { useState: ... } = React;` lines (CDN-style destructuring), replace with `import { useState, useMemo, useEffect, useCallback } from "react";`.
- **Globals removal**: CCM ends each file with `Object.assign(window, { ... });` — delete. Replace with `export default` / named exports.
- **Icon wrapper**: introduce `frontend/src/components/Icon.jsx` that wraps `lucide-react`'s dynamic icon by name. CCM uses `<Icon name="sparkles" size={14} />`. `lucide-react` exports named components; a lookup map keeps CCM's prop surface intact.
- **Tailwind**: copy CCM's `styles.css` OKLCH palette into `tailwind.config.js` theme extensions. The bulk of CCM uses utility classes; keep them verbatim.
- **date-fns**: CCM uses UMD `df.format(...)`; Vite version imports named functions. Replace `df.format` with `format` at call sites.
- **Data**: CCM reads from `window.__SCHEDULER_DATA` (a static fixture). Replace with `postsApi.list()` + `seriesApi.list()` from `frontend/src/api/client.js`.

**Test**: a ported component MUST render in Vite without touching
`window`.

## 7. Tailwind configuration

**Decision**: minimal `tailwind.config.js` pointing at
`./src/**/*.{js,jsx}` for content scanning. Theme extended with the
OKLCH palette CCM uses (cream background, terracotta accent, stone
neutrals). Fonts: Inter (already in `index.html` via Google Fonts) +
JetBrains Mono for the mono numerals. `@tailwind base/components/utilities`
directives go into `src/index.css`.

**Source**: CCM's `styles.css` pinned values.

## 8. Icon wrapper module

**Decision**: one small file — `frontend/src/components/Icon.jsx`:

```jsx
import {
  Sparkles, Megaphone, MessageSquare, Bell, Lock, GitBranch,
  X, Info, AlertTriangle, Ban, Check, Archive, Trash2,
  ChevronRight, Search, Calendar, List, Plus, ExternalLink,
} from "lucide-react";
const MAP = { sparkles: Sparkles, megaphone: Megaphone, "message-square": MessageSquare, ... };
export default function Icon({ name, size = 14, ...rest }) {
  const Cmp = MAP[name] ?? X;
  return <Cmp size={size} {...rest} />;
}
```

Keeps CCM's `<Icon name="..." size={n}>` prop surface unchanged
across all ported components.

## 9. Legacy 002 routes

**Decision**: `App.jsx` routes `/` → `Dashboard`, `/login` → `Login`,
`/register` → `Register`. The 002 routes (`/series`, `/series/new`,
`/series/:id`, `/posts/new`, `/posts/:id/edit`, `/calendar`) are
dropped from the router AND the 002 page components (`PostsList`,
`PostEdit`, `CalendarPage`, `SeriesList`, `SeriesEdit`, `SeriesDetail`)
are DELETED from disk in the same PR. Rollback = `git revert`, not
re-enabling a commented-out route.

**Source**: user directive at the `/speckit-plan` re-run — drop the
`v2/` subfolder; Principle VIII's no-dead-code rule.

## 10. 002 tests grandfather policy

**Decision**: the 002 tests are updated in two passes in the same PR:

1. **Path rebase** — every `"/api/..."` literal in
   `backend/tests/test_auth.py`, `test_posts.py`, `test_scheduling.py`,
   `test_series.py` becomes `"/api/v1/..."`. Pure sed-style change.
   Preserves assertions and structure.
2. **Contract updates** — two specific test functions are rewritten:
   - `test_patch_rejects_platform_change_on_series_post` — the
     new behavior is "platform is editable on series posts"; test
     asserts 200 + re-checked 15-min instead of the 002 4xx.
   - `test_create_series_happy_path` — the series-create body is
     now the 4-stage template; test updates the request payload
     accordingly (same endpoint path, new body shape).

All other 002 backend tests (boundary cases, cascade delete,
ownership scoping, auth) keep their assertions and only get the path
rebase. The PR description enumerates which tests were touched and
why, per Principle V.

## 11. API versioning — `/api/v1` for everything

**Decision**: all three routers (`auth`, `posts`, `series`) mount
under `prefix="/api/v1"` in `backend/app/main.py`. `frontend/src/api/client.js`'s
`API_BASE` default becomes `http://localhost:8000/api/v1`. Env
override `VITE_API_URL` still works.

**Source**: user directive at `/speckit-plan` time: *"API should be
versioning, let's keep all API as v1"*.

**Why one-shot rebase instead of coexistent paths**:

- **Test surface**: coexistent `/api/...` + `/api/v1/...` doubles the
  test matrix and imposes maintenance tax on every future endpoint.
  Pure path rebase is a single find-and-replace and a one-line change
  in `main.py`.
- **Frontend**: a single `API_BASE` constant means no per-call
  branching. Changing one line in `client.js` handles the whole
  client surface.
- **CORS + Docker + env vars**: all path-insensitive. Nothing else
  changes.
- **External consumers**: none. This take-home has exactly one
  frontend (the ported CCM UI) and its own test suite. No third
  parties to deprecate gracefully.

**Path audit** (everything getting rebased):

| From (001/002) | To (003) |
|---|---|
| `/api/auth/register` | `/api/v1/auth/register` |
| `/api/auth/login` | `/api/v1/auth/login` |
| `/api/posts` (CRUD) | `/api/v1/posts` |
| `/api/posts/{id}` | `/api/v1/posts/{id}` |
| *new*                | `/api/v1/posts/{id}/archive` |
| *new*                | `/api/v1/posts/{id}/unarchive` |
| `/api/series` (CRUD) | `/api/v1/series` |
| `/api/series/{id}` | `/api/v1/series/{id}` |
| *new*                | `/api/v1/series/{id}/archive` |
| *new*                | `/api/v1/series/{id}/unarchive` |

The existing `app.include_router(..., prefix="/api")` lines in
`main.py` change to `prefix="/api/v1"`. The individual routers
`auth.router`, `posts.router`, `series.router` keep their internal
prefixes (`/auth`, `/posts`, `/series`).

## 12. Frontend structure — flat `frontend/src/components/` layout

**Decision**: ported CCM components live directly under
`frontend/src/components/` alongside the existing `Layout.jsx` and
`ProtectedRoute.jsx`. A single new page `frontend/src/pages/Dashboard.jsx`
replaces the six 002 pages, which are deleted.

**Source**: user directive at `/speckit-plan` time: *"I don't like
the folder structure in the frontend, v2 is not needed i think"*.

**Why no suffix / subdirectory**:

- This 003 upgrade is now the app. There is no coexistent prior
  frontend surface to disambiguate from — the 002 pages are deleted
  in the same PR.
- Filenames match CCM's names (`ListView`, `CalendarView`,
  `SeriesBuilder`, `PostForm`, `ConfirmModal`, `Toast`,
  `Primitives`, `Icon`) without suffix — reviewers can diff against
  the CCM source directly.
- `Layout.jsx` is the natural home for CCM's `TopNav` + `SubHeader`
  pattern (they are layout-level concerns); merging them in removes
  two files compared to the earlier plan.

## Open questions

**None**. The 13 prior clarifications plus the 12 decisions above
cover every implementation surface. `/speckit-tasks` can proceed.
