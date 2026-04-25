# Contract: scheduling invariants

Updates to the 002 invariant + a new Sequential Integrity check,
delivered in the 003 upgrade.

## `check_platform_gap` — updated signature

```python
async def check_platform_gap(
    db: AsyncSession,
    *,
    owner_id: int,
    platform: str,
    scheduled_at: Optional[datetime],
    exclude_post_id: Optional[int] = None,
) -> Optional[Conflict]:
    ...
```

**Semantics (changes from 002)**:

| Property | Updated behavior (003) |
|---|---|
| Null exemption | unchanged (drafts bypass) |
| Scope | unchanged (owner + platform) |
| Status scope | **CHANGED** — posts with `status == "archived"` are NOT candidates. All other statuses (draft/scheduled/published/failed) still count. |
| Boundary | unchanged (strict `>` / `<`; exact 15 min is accepted) |
| Self-exclusion | unchanged |
| Return shape | unchanged (`Conflict(other_post_id, other_scheduled_at, delta_minutes)`) |

Caller list:

| Caller | Invokes | With `exclude_post_id`? |
|---|---|---|
| `POST /api/v1/posts` | once per create | no |
| `PATCH /api/v1/posts/{id}` | once per update with platform/time change | yes (self) |
| `POST /api/v1/series` | 4× per create (one per stage) + pairwise stage check | no (none persisted yet) — this is the new templated series-create path |

## `check_sequential_integrity` — new

```python
@dataclass(frozen=True)
class SeqConflict:
    offending_index: int
    prior_index: int
    offending_at: datetime
    prior_at: datetime

    @property
    def human_message(self) -> str:
        return (
            f"Stage #{self.offending_index + 1} is scheduled at or before "
            f"stage #{self.prior_index + 1}."
        )


def check_sequential_integrity(times: list[datetime]) -> Optional[SeqConflict]:
    for i in range(1, len(times)):
        if times[i] <= times[i - 1]:
            return SeqConflict(i, i - 1, times[i], times[i - 1])
    return None
```

**Pure function, no DB access.** Called by:

| Caller | Inputs |
|---|---|
| `POST /api/v1/series` | the 4 stage `scheduled_at` values in order |
| `PATCH /api/v1/posts/{id}` (when post belongs to a series and time changed) | the series' post times with this post's new time substituted |

Returns `None` on strict increasing order; `SeqConflict` on first
violation.

## 409 body for Sequential Integrity

```json
HTTP 409 Conflict
{
  "detail": {
    "error": "sequential_integrity_violation",
    "message": "Stage #3 is scheduled at or before stage #2.",
    "offending_post_index": 2,
    "prior_post_index": 1,
    "offending_at": "2026-05-01T08:00:00Z",
    "prior_at": "2026-05-01T09:00:00Z"
  }
}
```

Frontend renders `detail.message` verbatim (Principle VII / FR-018a).
Uses `offending_post_index` to highlight the right stage block in
`SeriesBuilder` or the right row in `ListView`.

## Invariant ordering in the templated series-create path

For atomicity and clearest error-reporting, the server MUST run
validations in this order:

1. Pydantic validation (422 on shape violations, including stage
   label / stage count).
2. `check_sequential_integrity(times)` — if non-None, 409
   `sequential_integrity_violation`.
3. Per-stage `check_platform_gap` against existing posts — if any
   returns non-None, 409 `platform_gap_conflict` with
   `series_post_index = i`.
4. Pairwise same-platform check across the 4 stages themselves —
   if any two stages share platform and are < 15 min apart, 409
   `platform_gap_conflict` with `series_post_index` set to the
   later of the pair.
5. Open transaction, insert Series + 4 Posts, commit.

If any of 1–4 fails, nothing is persisted.

## Tests (Principle IX TF-first)

Every update to this contract is test-first. The tests listed in
`data-model.md` §9 are the minimum set; additional edge-case tests
MAY be added but MUST NOT weaken the semantics above.
