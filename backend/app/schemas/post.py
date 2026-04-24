from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class PostBase(BaseModel):
    title: str
    platform: str
    scheduled_at: Optional[datetime] = None
    status: str = "draft"


class PostCreate(PostBase):
    pass


class PostUpdate(BaseModel):
    title: Optional[str] = None
    platform: Optional[str] = None
    scheduled_at: Optional[datetime] = None
    status: Optional[str] = None


class PostResponse(PostBase):
    id: int
    owner_id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
