from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum

from app.core.database import Base


class PostStatus(str, enum.Enum):
    DRAFT = "draft"
    SCHEDULED = "scheduled"
    PUBLISHED = "published"
    FAILED = "failed"
    ARCHIVED = "archived"


class Post(Base):
    __tablename__ = "posts"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    platform = Column(String(64), nullable=False)
    scheduled_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(String(32), default=PostStatus.DRAFT.value, nullable=False)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    series_id = Column(Integer, ForeignKey("series.id"), nullable=True)
    series_position = Column(Integer, nullable=True)
    body = Column(Text, nullable=True)
    published_url = Column(String(1024), nullable=True)
    stage = Column(String(32), nullable=True)
    previous_status = Column(String(32), nullable=True)
    # 006 additions — failure annotation (see specs/006-auto-publish-flow/data-model.md).
    # Both columns NULL by default; the publisher writes them on a failed
    # auto-publish attempt and clears them on the next successful publish.
    last_publish_attempt_at = Column(DateTime(timezone=True), nullable=True)
    last_publish_error = Column(String(64), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    owner = relationship("User", back_populates="posts")
    series = relationship("Series", back_populates="posts")

    @property
    def author(self):
        """FR-009 / FR-027: derived display name — NOT a DB column.

        Falls back to email when full_name is NULL/empty. Requires
        the `owner` relationship to be eagerly loaded
        (`selectinload(Post.owner)`) so async attribute access does
        not trigger a lazy-load.
        """
        owner = self.owner
        if owner is None:
            return None
        return owner.full_name or owner.email
