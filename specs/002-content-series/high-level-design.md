# High-Level Design: Content Series

**Feature**: `specs/002-content-series`
**Date**: 2026-04-22
**Audience**: reviewer / new contributor who wants a visual grounding before
reading `plan.md` or the code.

This document has two halves:

1. **What's in the repo today** (after `001-docker-compose` merged).
2. **What this feature adds** (the Series layer + invariant enforcement).

All diagrams are Mermaid. If your reader doesn't render Mermaid, fall back
to the adjacent prose summary.

---

## 1. Current state (what exists today)

### 1.1 System context

```mermaid
flowchart LR
    Browser[Browser<br/>React UI] -->|HTTP JSON| FastAPI
    Dev[Developer workstation] -->|docker compose up| Compose{{docker-compose.yml}}
    Compose --> FE[frontend<br/>node:20-alpine<br/>vite dev]
    Compose --> BE[backend<br/>python:3.11-slim<br/>uvicorn --reload]
    FE -->|bind mount| FESrc[frontend/src/]
    BE -->|bind mount| BESrc[backend/]
    BE -->|sqlite+aiosqlite| DB[(backend/scheduler.db<br/>host-visible file)]
    GH[GitHub Actions<br/>ubuntu-latest] -->|PR| CI[[CI workflow<br/>backend-tests • frontend-tests<br/>frontend-lint • compose-build]]

    style BE fill:#f0f8ff
    style FE fill:#fff0f5
    style DB fill:#fffacd
    style CI fill:#e6ffe6
```

**What the diagram says**:
- Two containers, one SQLite file on the host shared by the venv workflow
  and the Docker workflow.
- CI runs four independent jobs on every PR; none of them need Docker to be
  running except `compose-build` (which only `build`s, doesn't `up`).

### 1.2 Current backend modules

```mermaid
flowchart TB
    subgraph backend/app/
        direction LR
        main[main.py<br/>FastAPI app + CORS + router wiring]
        subgraph core/
            config[config.py<br/>Settings]
            database[database.py<br/>async engine + init_db]
            security[security.py<br/>JWT + bcrypt]
        end
        subgraph models/
            user_m[user.py<br/>User]
            post_m[post.py<br/>Post]
        end
        subgraph schemas/
            user_s[user.py<br/>UserCreate/Login/Response]
            post_s[post.py<br/>PostCreate/Update/Response]
        end
        subgraph api/
            auth_api[auth.py<br/>register • login]
            posts_api[posts.py<br/>CRUD]
            deps[deps.py<br/>get_current_user_id]
        end
    end

    main --> auth_api
    main --> posts_api
    posts_api --> deps
    posts_api --> post_m
    posts_api --> post_s
    auth_api --> user_m
    auth_api --> user_s
    auth_api --> security
    deps --> security
    post_m --> database
    user_m --> database

    style main fill:#e0e7ff
    style posts_api fill:#fef3c7
    style auth_api fill:#fef3c7
```

### 1.3 Current data model (ER)

```mermaid
erDiagram
    USER ||--o{ POST : owns

    USER {
        int id PK
        string email "unique"
        string hashed_password
        string full_name "nullable"
        datetime created_at
    }
    POST {
        int id PK
        string title
        string platform
        datetime scheduled_at "nullable"
        string status "draft|scheduled|published|failed"
        int owner_id FK
        datetime created_at
        datetime updated_at
    }
```

### 1.4 Current critical paths

**Post creation today (NO invariant enforcement)**:

```mermaid
sequenceDiagram
    participant UI as PostEdit.jsx
    participant API as /api/posts (POST)
    participant DB as SQLite

    UI->>API: POST { title, platform, scheduled_at, status }
    API->>API: validate Pydantic
    API->>DB: INSERT INTO posts VALUES (...)
    DB-->>API: row id
    API-->>UI: 201 + PostResponse

    Note over API,DB: No 15-min check anywhere.<br/>Two Instagram posts at the same second<br/>succeed today. THIS IS THE GAP.
```

### 1.5 Gaps surfaced by `plan/gaps.md`

- `Series` concept entirely absent (no model, schema, API, UI).
- **15-min same-platform invariant is NOT enforced** — the exact gap the
  Content Series feature must close (Constitution Principle III).
- `PostResponse` has no way to surface series membership to the UI.

---

## 2. Proposed state (with Content Series)

### 2.1 System context — deltas

Nothing changes at the infrastructure layer. Same containers, same DB
file, same CI workflow. All additions are in application code and in the
schema of the existing SQLite file:

```mermaid
flowchart LR
    Browser[Browser] -->|HTTP JSON| FastAPI
    FastAPI -->|new: /api/series/*| SeriesAPI[SeriesAPI 🆕]
    FastAPI -->|existing + invariant hook| PostsAPI[PostsAPI ⚙️]
    PostsAPI -.->|calls| Inv[[check_platform_gap 🆕<br/>app/core/scheduling.py]]
    SeriesAPI -.->|calls| Inv
    SeriesAPI -->|atomic insert| DB
    PostsAPI -->|insert/update| DB
    Inv -->|read| DB
    DB[(scheduler.db<br/>+ series table<br/>+ 2 cols on posts)]

    style SeriesAPI fill:#c7f7c7
    style Inv fill:#ffe4b5
    style DB fill:#fffacd
```

**Call-outs**:
- `PostsAPI` is the existing module; it gains **two** call sites to
  `check_platform_gap` (in `create_post` and `update_post`). No other
  refactor.
- `SeriesAPI` is brand new. It is the primary consumer of the invariant
  during bulk materialization.
- `check_platform_gap` is pure-read; it never writes. Writes stay in the
  two API modules.

### 2.2 Updated backend module map

```mermaid
flowchart TB
    subgraph backend/app/
        direction LR
        main[main.py<br/>+ include_router series.router]
        subgraph core/
            config2[config.py]
            database2[database.py<br/>+ idempotent ALTER 🆕]
            security2[security.py]
            sched[scheduling.py 🆕<br/>check_platform_gap]
        end
        subgraph models/
            user_m2[user.py<br/>+ series relationship]
            post_m2[post.py<br/>+ series_id + series_position]
            series_m[series.py 🆕<br/>Series]
        end
        subgraph schemas/
            user_s2[user.py]
            post_s2[post.py<br/>Response + series fields]
            series_s[series.py 🆕]
        end
        subgraph api/
            auth_api2[auth.py]
            posts_api2[posts.py<br/>+ invariant hook 🆕]
            series_api[series.py 🆕<br/>POST/GET/PATCH/DELETE]
            deps2[deps.py]
        end
    end

    main --> auth_api2
    main --> posts_api2
    main --> series_api
    posts_api2 --> sched
    series_api --> sched
    series_api --> series_m
    series_api --> series_s
    posts_api2 --> post_m2
    post_m2 --> series_m
    series_m --> database2

    style sched fill:#ffe4b5
    style series_m fill:#c7f7c7
    style series_s fill:#c7f7c7
    style series_api fill:#c7f7c7
    style database2 fill:#fed7aa
    style posts_api2 fill:#fef3c7
```

### 2.3 Updated ER diagram (Series added)

```mermaid
erDiagram
    USER ||--o{ POST : owns
    USER ||--o{ SERIES : owns
    SERIES ||--o{ POST : contains

    USER {
        int id PK
        string email "unique"
        string hashed_password
        string full_name "nullable"
        datetime created_at
    }
    SERIES {
        int id PK
        string title
        string description "nullable"
        string platform "literal set"
        datetime start_at
        string cadence_unit "days|weeks"
        int cadence_interval "1..30"
        int post_count "1..20"
        int owner_id FK
        datetime created_at
        datetime updated_at
    }
    POST {
        int id PK
        string title
        string platform
        datetime scheduled_at "nullable"
        string status
        int owner_id FK
        int series_id FK "nullable"
        int series_position "nullable; 0-indexed"
        datetime created_at
        datetime updated_at
    }
```

Invariant (code-level, not DB-level): `series_id IS NULL` iff
`series_position IS NULL`.

### 2.4 Series creation flow (happy path)

```mermaid
sequenceDiagram
    participant UI as SeriesEdit.jsx
    participant C as seriesApi.create
    participant API as POST /api/series
    participant V as check_platform_gap
    participant DB as SQLite

    UI->>UI: user fills form (title, platform, start_at, cadence, count)
    UI->>UI: live-preview N timestamps
    UI->>C: submit payload
    C->>API: POST /api/series { ... }
    API->>API: Pydantic validate SeriesCreate
    API->>API: compute N timestamps (cadence math)
    loop pairwise sibling precheck
        API->>API: any two < 15 min apart on same platform?
    end
    loop for each of N times
        API->>V: check_platform_gap(owner, platform, t)
        V->>DB: SELECT … WHERE owner AND platform AND time in window
        DB-->>V: 0 rows
        V-->>API: None (clear)
    end
    API->>DB: BEGIN TX
    API->>DB: INSERT INTO series (…)
    API->>DB: INSERT INTO posts (…) × N
    API->>DB: COMMIT
    DB-->>API: series + posts
    API-->>C: 201 SeriesResponse (with posts[])
    C-->>UI: render detail page
```

### 2.5 Series creation flow (conflict path — atomic abort)

```mermaid
sequenceDiagram
    participant UI as SeriesEdit.jsx
    participant API as POST /api/series
    participant V as check_platform_gap
    participant DB as SQLite

    UI->>API: POST /api/series { ... }
    API->>API: validate + compute N timestamps
    API->>V: check_platform_gap(t_0)
    V->>DB: SELECT …
    DB-->>V: existing post id=42, 7 min later
    V-->>API: Conflict(other_post_id=42, delta=7)
    Note over API: short-circuit on FIRST conflict (Clarify-Q3 → A)<br/>NO db.add has been called yet
    API-->>UI: 409 {detail: {error, message,<br/>  conflict_with_post_id: 42,<br/>  delta_minutes: 7,<br/>  series_post_index: 0}}
    UI->>UI: show toast with detail.message

    Note over API,DB: Zero rows persisted. Same transaction semantics<br/>as single-post 409. FR-011 amended.
```

### 2.6 15-min invariant decision tree

```mermaid
flowchart TD
    Start([post write]) --> HasTime{scheduled_at<br/>null?}
    HasTime -- yes --> Accept([accept — drafts exempt<br/>FR-012])
    HasTime -- no --> Query[SELECT posts WHERE<br/>owner=X AND platform=Y<br/>AND scheduled_at IS NOT NULL<br/>AND scheduled_at IN -15m, +15m]
    Query --> IsUpdate{calling from PATCH?}
    IsUpdate -- yes --> Exclude[exclude current post.id]
    IsUpdate -- no --> Skip[do not exclude]
    Exclude --> Found
    Skip --> Found{any row found?}
    Found -- no --> Accept2([accept — slot is clear])
    Found -- yes --> Conflict([409 platform_gap_conflict])

    style Accept fill:#d4edda
    style Accept2 fill:#d4edda
    style Conflict fill:#f8d7da
```

The strict-less-than boundary (`> lower AND < upper`) is the reason
**exactly 15 min apart is accepted** — matches the spec's one scrutinized
assertion.

### 2.7 Frontend route + component map

```mermaid
flowchart TB
    App[App.jsx<br/>BrowserRouter]
    App --> Login[/login → Login.jsx/]
    App --> Register[/register → Register.jsx/]
    App --> Protected[ProtectedRoute]
    Protected --> Layout[Layout.jsx<br/>nav + Outlet]
    Layout --> PostsList[/ → PostsList.jsx<br/>+ series badge 🆕/]
    Layout --> PostEdit[/posts/new or /posts/:id/edit<br/>→ PostEdit.jsx<br/>UNCHANGED per FR-005a/]
    Layout --> Calendar[/calendar → CalendarPage.jsx/]
    Layout --> SeriesList[/series → SeriesList.jsx 🆕/]
    Layout --> SeriesEdit[/series/new → SeriesEdit.jsx 🆕/]
    Layout --> SeriesDetail[/series/:id → SeriesDetail.jsx 🆕/]

    SeriesList -->|click row| SeriesDetail
    SeriesDetail -->|click post| PostEdit
    PostsList -.->|badge links to| SeriesDetail

    style SeriesList fill:#c7f7c7
    style SeriesEdit fill:#c7f7c7
    style SeriesDetail fill:#c7f7c7
    style PostEdit fill:#e5e7eb
    style PostsList fill:#fef3c7
```

Green = new. Yellow = existing, minor edit (badge only). Gray = untouched.

### 2.8 DB rollout strategy

```mermaid
flowchart TD
    Start([app start]) --> CreateAll[Base.metadata.create_all<br/>creates new `series` table<br/>on both fresh and existing DBs]
    CreateAll --> Probe[PRAGMA table_info posts]
    Probe --> Has1{series_id exists?}
    Has1 -- yes --> Has2
    Has1 -- no --> Add1[ALTER TABLE posts<br/>ADD COLUMN series_id INTEGER<br/>REFERENCES series id]
    Add1 --> Has2{series_position exists?}
    Has2 -- yes --> Ready
    Has2 -- no --> Add2[ALTER TABLE posts<br/>ADD COLUMN series_position INTEGER]
    Add2 --> Ready([ready to serve])

    style Add1 fill:#fed7aa
    style Add2 fill:#fed7aa
    style Ready fill:#d4edda
```

On existing reviewer DB: both ALTERs run once. On fresh DB or subsequent
restarts: both short-circuit. Reviewers run nothing extra (SC-003).

## 3. Delta summary (what changed between current and proposed)

| Layer | Added | Modified | Removed |
|---|---|---|---|
| `backend/app/core/` | `scheduling.py` | `database.py` (idempotent ALTER) | — |
| `backend/app/models/` | `series.py` | `post.py` (2 cols), `user.py` (relationship) | — |
| `backend/app/schemas/` | `series.py` | `post.py` (`PostResponse` gains read-only series fields) | — |
| `backend/app/api/` | `series.py` | `posts.py` (invariant wiring) | — |
| `backend/app/` | — | `main.py` (one `include_router` line) | — |
| `backend/tests/` | `test_scheduling.py`, `test_series.py` | `test_posts.py` (invariant cases) | — |
| `frontend/src/api/` | — | `client.js` (+ `seriesApi`) | — |
| `frontend/src/pages/` | `SeriesList.jsx`, `SeriesEdit.jsx`, `SeriesDetail.jsx` | `PostsList.jsx` (badge) | — |
| `frontend/src/components/` | — | `Layout.jsx` (nav link) | — |
| `frontend/src/` | — | `App.jsx` (3 new routes) | — |
| CI / infra | — | none | — |

Not touched (deliberately): `frontend/src/pages/PostEdit.jsx`,
`frontend/src/pages/Login.jsx`, `frontend/src/pages/Register.jsx`,
`frontend/src/pages/CalendarPage.jsx`, `backend/app/api/auth.py`,
`backend/app/core/security.py`, `backend/scripts/seed_data.py` (optional
enrichment, kept untouched by default).

## 4. Open questions

**None** at the pre-`/speckit-tasks` gate. Principle VI check passes.
