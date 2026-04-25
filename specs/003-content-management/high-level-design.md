# High-Level Design: Content Management (003 upgrade)

**Feature**: `specs/003-content-management`
**Date**: 2026-04-22
**Audience**: reviewer / new contributor approaching the 003 upgrade cold.

Two halves: what exists after 002 merged, and what 003 adds on top.

---

## 1. Current state (after 001 + 002)

### 1.1 System context

```mermaid
flowchart LR
    Browser[Browser<br/>React 19 / Vite] -->|HTTP JSON| FastAPI
    FastAPI --> Auth[/auth/*]
    FastAPI --> Posts[/posts/* with 15-min invariant]
    FastAPI --> Series[/series/* v1 cadence-based]
    Posts -.->|calls| SG[[check_platform_gap<br/>app/core/scheduling.py]]
    Series -.->|calls| SG
    FastAPI -->|async SQLAlchemy| DB[(scheduler.db<br/>SQLite)]
    CI[GitHub Actions<br/>4 parallel jobs] -->|on every PR| Repo
```

### 1.2 ER diagram

```mermaid
erDiagram
    USER ||--o{ POST : owns
    USER ||--o{ SERIES : owns
    SERIES ||--o{ POST : contains

    USER {
        int id PK
        string email
        string hashed_password
        string full_name
        datetime created_at
    }
    SERIES {
        int id PK
        string title
        string description
        string platform
        datetime start_at
        string cadence_unit
        int cadence_interval
        int post_count
        int owner_id FK
        datetime created_at
        datetime updated_at
    }
    POST {
        int id PK
        string title
        string platform
        datetime scheduled_at
        string status
        int owner_id FK
        int series_id FK
        int series_position
        datetime created_at
        datetime updated_at
    }
```

### 1.3 Frontend page map

```mermaid
flowchart TB
    App[App.jsx]
    App --> Login[/login/]
    App --> Register[/register/]
    App --> Layout[ProtectedRoute + Layout]
    Layout --> PostsList[/ PostsList/]
    Layout --> PostEdit[/posts/:id/edit/]
    Layout --> Calendar[/calendar/]
    Layout --> SeriesList[/series/]
    Layout --> SeriesEdit[/series/new/]
    Layout --> SeriesDetail[/series/:id/]
```

### 1.4 002 limits 003 will address

- `Post` has no `body` column — creators can only write a title.
- `status` enum lacks a "soft-deleted" terminal; published posts can only be hard-deleted.
- Series must be single-platform; posts within a series can't change platform (FR-005b).
- Cadence-driven series creation (user picks an interval) doesn't match the template-driven UX 003 ships.
- No per-view archive filter; no recovery path.

---

## 2. Proposed state (003 upgrade)

### 2.1 System context

```mermaid
flowchart LR
    Browser --> FastAPI
    FastAPI --> Auth[/auth/*]
    FastAPI --> PostsApi[/posts/*<br/>+ archive / unarchive 🆕<br/>+ sequential-integrity re-check 🆕<br/>invariant excludes archived 🆕]
    FastAPI --> SeriesV1[/series/* legacy]
    FastAPI --> SeriesApi[/api/v1/series 🆕 templated body<br/>+ archive / unarchive 🆕<br/>+ delete guard for published 🆕]
    PostsApi -.-> SG[[check_platform_gap<br/>now excludes archived]]
    PostsApi -.-> SI[[check_sequential_integrity 🆕]]
    SeriesApi -.-> SG
    SeriesApi -.-> SI
    FastAPI --> DB[(scheduler.db<br/>+ body, published_url,<br/>stage, previous_status on posts<br/>+ status, previous_status on series)]

    style PostsApi fill:#fef3c7
    style SeriesApi fill:#c7f7c7
    style SI fill:#ffe4b5
    style SG fill:#ffe4b5
    style DB fill:#fffacd
```

### 2.2 ER diagram (003 deltas highlighted)

```mermaid
erDiagram
    USER ||--o{ POST : owns
    USER ||--o{ SERIES : owns
    SERIES ||--o{ POST : contains

    USER {
        int id PK
        string email
        string hashed_password
        string full_name
        datetime created_at
    }
    SERIES {
        int id PK
        string title
        string description
        string platform "vestigial in 003"
        datetime start_at "vestigial in 003"
        string cadence_unit "vestigial in 003"
        int cadence_interval "vestigial in 003"
        int post_count
        int owner_id FK
        string status "NEW — active/archived"
        string previous_status "NEW"
        datetime created_at
        datetime updated_at
    }
    POST {
        int id PK
        string title
        string platform
        datetime scheduled_at
        string status "enum adds archived"
        int owner_id FK
        int series_id FK
        int series_position
        string stage "NEW — Teaser/Announcement/Follow-up/Reminder"
        string body "NEW — text"
        string published_url "NEW"
        string previous_status "NEW"
        datetime created_at
        datetime updated_at
    }
```

### 2.3 Series-creation sequence (templated 4-stage)

```mermaid
sequenceDiagram
    participant UI as SeriesBuilder (ported CCM)
    participant API as POST /api/v1/series
    participant SI as check_sequential_integrity
    participant SG as check_platform_gap
    participant DB as SQLite

    UI->>UI: user fills 4 stages (platform, title, body, date+time)
    UI->>UI: client pre-check: sequential + 15-min
    UI->>API: POST { name, description, stages[4] }
    API->>API: validate Pydantic (stage labels + order)
    API->>SI: check_sequential_integrity(times)
    SI-->>API: None (ok) | SeqConflict
    loop for each of 4 stages
        API->>SG: check_platform_gap(owner, stage.platform, stage.time)
        SG->>DB: SELECT posts WHERE ... AND status != 'archived'
        DB-->>SG: 0 rows | conflict row
        SG-->>API: None | Conflict
    end
    API->>API: pairwise stage 15-min (same-platform siblings)
    API->>DB: BEGIN; INSERT Series; INSERT 4 Posts; COMMIT
    DB-->>API: rows
    API-->>UI: 201 SeriesResponse (with 4 posts[])
```

### 2.4 Delete / archive decision tree

```mermaid
flowchart TD
    Start([user clicks Delete on a post]) --> Status{post.status?}
    Status -- draft / scheduled / failed --> HardPost[DELETE /api/v1/posts/id<br/>→ 204]
    Status -- published --> Guard[DELETE → 409<br/>published_requires_archive]
    Guard --> ShowArchive[UI swaps button to 'Archive']
    Status -- archived --> HardArchived[DELETE → 204<br/>remove archived row]
    ShowArchive --> ArchiveEp[POST /api/v1/posts/id/archive<br/>→ 200 archived]

    Start2([user clicks Delete on a series]) --> AnyPub{any post<br/>published?}
    AnyPub -- no --> HardSeries[DELETE /api/v1/series/id<br/>→ 204 cascade]
    AnyPub -- yes --> SeriesGuard[DELETE → 409<br/>series_has_published_posts]
    SeriesGuard --> ShowArchiveSeries[UI swaps to 'Archive Series']
    ShowArchiveSeries --> ArchiveSeriesEp[POST /api/v1/series/id/archive<br/>→ 200 cascade archive]

    style HardPost fill:#d4edda
    style HardSeries fill:#d4edda
    style Guard fill:#f8d7da
    style SeriesGuard fill:#f8d7da
    style ArchiveEp fill:#fef3c7
    style ArchiveSeriesEp fill:#fef3c7
```

### 2.5 Frontend page + component map (003)

```mermaid
flowchart TB
    App[App.jsx]
    App --> Login[/login/]
    App --> Register[/register/]
    App --> Protected[ProtectedRoute + Layout]
    Protected --> Dashboard[/ Dashboard 🆕/]
    Dashboard --> TopNav[TopNav 🆕]
    Dashboard --> SubHeader[SubHeader 🆕]
    Dashboard --> ListView[ListView 🆕<br/>shows archived faded]
    Dashboard --> CalendarView[CalendarView 🆕<br/>hides archived]
    Dashboard --> PostForm[PostForm modal 🆕]
    Dashboard --> SeriesBuilder[SeriesBuilder modal 🆕<br/>4-stage template<br/>15-min banner<br/>sequential precheck]
    Dashboard --> ConfirmModal[ConfirmModal 🆕]
    Dashboard --> Toast[Toast 🆕]

    Protected -.->|de-routed, kept on disk| Legacy[002 pages:<br/>SeriesList, SeriesEdit,<br/>SeriesDetail, PostsList]

    style Dashboard fill:#c7f7c7
    style SeriesBuilder fill:#c7f7c7
    style ListView fill:#c7f7c7
    style CalendarView fill:#c7f7c7
    style Legacy fill:#e5e7eb
```

### 2.6 Status state machine (003)

```mermaid
stateDiagram-v2
    [*] --> draft: POST /api/v1/posts (no time)
    [*] --> scheduled: POST /api/v1/posts (with time)<br/>or POST /api/v1/series
    draft --> scheduled: PATCH with scheduled_at
    scheduled --> published: external publisher (future)
    scheduled --> failed: external publisher (future)
    draft --> archived: POST /archive<br/>(saves previous_status)
    scheduled --> archived: POST /archive
    published --> archived: POST /archive (only way to 'delete' published)
    failed --> archived: POST /archive
    archived --> draft: POST /unarchive (restores)
    archived --> scheduled: POST /unarchive
    archived --> published: POST /unarchive
    archived --> failed: POST /unarchive
    draft --> [*]: DELETE (hard)
    scheduled --> [*]: DELETE (hard)
    failed --> [*]: DELETE (hard)
    archived --> [*]: DELETE (hard — archived already soft)
    published --> [*]: DELETE rejected 409<br/>user must archive first
```

## 3. Delta summary

| Layer | New | Modified | Removed |
|---|---|---|---|
| `backend/app/core/scheduling.py` | `check_sequential_integrity`, `SeqConflict` | `check_platform_gap` (archive exclusion) | — |
| `backend/app/core/database.py` | — | `init_db` idempotent ALTER block extended | — |
| `backend/app/models/post.py` | — | +4 columns | — |
| `backend/app/models/series.py` | — | +2 columns | — |
| `backend/app/schemas/post.py` | — | `body` on Create/Update; new read-only fields + derived `author` on Response | — |
| `backend/app/schemas/series.py` | `SeriesApiCreate`, `SeriesApiStagePayload` | — | — |
| `backend/app/api/v1/posts.py` | `archive`, `unarchive` handlers; `include_archived` query param; DELETE guard | PATCH drops FR-005b; PATCH adds sequential integrity re-check | FR-005b platform-guard branch |
| `backend/app/api/v1/series.py` | Templated create, archive, unarchive handlers; DELETE guard | List `include_archived` param | — |
| `backend/tests/test_posts.py` | archive / unarchive / DELETE guard / FR-005b removal | +20 cases | one test rewritten |
| `backend/tests/test_scheduling.py` | archive exclusion, sequential integrity | — | — |
| `backend/tests/test_series.py` | — | one test rewritten | — |
| `backend/tests/test_series.py` | — | New cases added for archival, templated create, and Sequential Integrity | — |
| `frontend/package.json` | — | +tailwindcss/postcss/autoprefixer/lucide-react | — |
| `frontend/postcss.config.js`, `tailwind.config.js` | NEW | — | — |
| `frontend/src/components/` | NEW: `ListView.jsx`, `CalendarView.jsx`, `PostForm.jsx`, `SeriesBuilder.jsx`, `ConfirmModal.jsx`, `Toast.jsx`, `Primitives.jsx`, `Icon.jsx`, `utils.js` | `Layout.jsx` rewritten for CCM nav pattern | — |
| `frontend/src/pages/Dashboard.jsx` | NEW | — | — |
| `frontend/src/pages/` | — | — | `PostsList.jsx`, `PostEdit.jsx`, `CalendarPage.jsx`, `SeriesList.jsx`, `SeriesEdit.jsx`, `SeriesDetail.jsx` (all 6 deleted) |
| `frontend/src/App.jsx` | — | Routes simplified to `/login`, `/register`, `/` → Dashboard; 002 routes removed | — |
| `frontend/src/api/client.js` | archive/unarchive methods, `include_archived` param | `seriesApi.create` body updated to 4-stage shape; `API_BASE` → `/api/v1` | — |
| `frontend/src/api/client.test.js` | — | +Vitest cases for new API | — |
| `readme.md` | — | Short "003 upgrade" section | — |

## 4. Open questions

**None** at this gate. Thirteen prior clarifications + ten research
decisions cover every surface.
