from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


Status = Literal["draft", "scheduled", "published", "failed", "archived"]
# 006 / FR-018 — narrow set of statuses a CLIENT may set on POST/PATCH.
# `published` and `failed` are server-only outcomes (auto-publish or
# manual /publish for `published`; reserved for backend-driven failure
# for `failed`). Pydantic returns 422 if a request tries to send
# either of those values. PostResponse keeps the full Status enum so
# the server can still emit them.
StatusUserSettable = Literal["draft", "scheduled", "archived"]
Platform = Literal["youtube", "instagram", "twitter", "tiktok", "linkedin"]
Stage = Literal["Teaser", "Announcement", "Follow-up", "Reminder"]


class PostBase(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    platform: Platform
    scheduled_at: Optional[datetime] = None
    body: Optional[str] = Field(default=None, max_length=5000)


class PostCreate(PostBase):
    # FR-018 — client may not set published/failed; default remains draft.
    status: StatusUserSettable = "draft"


class PostUpdate(BaseModel):
    # FR-010: on any post (standalone or series-child) allow edits to
    # title / platform / scheduled_at / status / body. series_id,
    # series_position, stage, previous_status, published_url, author
    # are NOT editable via PATCH (state machine + derived fields).
    # FR-018 — status narrows to user-settable subset.
    title: Optional[str] = Field(default=None, min_length=1, max_length=255)
    platform: Optional[Platform] = None
    scheduled_at: Optional[datetime] = None
    status: Optional[StatusUserSettable] = None
    body: Optional[str] = Field(default=None, max_length=5000)


class PostResponse(PostBase):
    id: int
    owner_id: int
    status: Status = "draft"
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    series_id: Optional[int] = None
    series_position: Optional[int] = None
    stage: Optional[Stage] = None
    published_url: Optional[str] = None
    previous_status: Optional[Status] = None
    author: Optional[str] = None  # derived at serialization time from owner.full_name / .email (NOT a column)
    # 006 — failure annotation surfaced to clients (see data-model.md).
    last_publish_attempt_at: Optional[datetime] = None
    last_publish_error: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)
