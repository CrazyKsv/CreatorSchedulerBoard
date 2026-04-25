from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.post import PostResponse, Platform, Stage

CadenceUnit = Literal["days", "weeks"]
SeriesStatus = Literal["active", "archived"]


class SeriesStagePayload(BaseModel):
    """One stage in the 4-stage templated series-create body (FR-001..005)."""

    stage: Stage
    platform: Platform
    title: str = Field(min_length=1, max_length=255)
    body: Optional[str] = Field(default=None, max_length=5000)
    scheduled_at: datetime


class SeriesCreate(BaseModel):
    """003 T023: templated series-create body — REPLACES the 002 cadence-based
    shape (see Clarifications `/speckit-plan` re-run entry on API versioning).

    A series runs on exactly one platform. The Pydantic-level invariant below
    enforces that all 4 stages share the same platform; creators who want the
    same narrative on a second channel use the Clone action in the UI, which
    submits a second create call.
    """

    title: str = Field(min_length=1, max_length=255)
    description: Optional[str] = Field(default=None, max_length=1000)
    stages: list[SeriesStagePayload] = Field(min_length=4, max_length=4)
    # 004: when set, the new series joins the source's family so the UI can
    # group siblings under one card with platform tabs. Ownership + existence
    # are validated in the router (not here) so we can return structured
    # 404 / 403 errors instead of a Pydantic ValidationError.
    source_series_id: Optional[int] = None

    @model_validator(mode="after")
    def _single_platform_across_stages(self):
        platforms = {s.platform for s in self.stages}
        if len(platforms) > 1:
            raise ValueError(
                "all stages in a series must share the same platform "
                f"(saw {sorted(platforms)}); clone the series to another "
                "platform instead of mixing channels within one arc"
            )
        return self


class SeriesUpdate(BaseModel):
    # FR-007 (003): only title and description are user-editable after creation.
    # Cadence metadata + status remain read-only (status flips via the
    # dedicated archive/unarchive endpoints).
    title: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = Field(default=None, max_length=1000)


class SeriesSummary(BaseModel):
    """Series list / summary shape (no embedded posts).

    Retains legacy cadence metadata columns for backwards compatibility
    with 002 rows that remain in the DB; users cannot create new ones
    through this shape in 003.
    """

    id: int
    owner_id: int
    title: str
    description: Optional[str] = None
    platform: Platform
    start_at: datetime
    cadence_unit: CadenceUnit
    cadence_interval: int
    post_count: int
    status: SeriesStatus = "active"
    previous_status: Optional[SeriesStatus] = None
    # 004: family grouping anchor. Freshly-created series self-reference
    # (family_id == id); clones share their source's family_id.
    family_id: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class SeriesResponse(SeriesSummary):
    posts: list[PostResponse] = []
