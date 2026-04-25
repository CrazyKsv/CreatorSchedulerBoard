from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class Series(Base):
    __tablename__ = "series"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    description = Column(String(1000), nullable=True)
    platform = Column(String(64), nullable=False)
    start_at = Column(DateTime(timezone=True), nullable=False)
    cadence_unit = Column(String(16), nullable=False)
    cadence_interval = Column(Integer, nullable=False)
    post_count = Column(Integer, nullable=False)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    status = Column(String(32), nullable=False, default="active")
    previous_status = Column(String(32), nullable=True)
    # 004: series that share a family_id are the same narrative arc cloned
    # across multiple platforms. A fresh series self-references (family_id ==
    # id) so every row belongs to exactly one family; clones inherit the
    # source's family_id so the relationship is flat, not linked-list.
    family_id = Column(
        Integer,
        ForeignKey("series.id"),
        nullable=True,
        index=True,
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    owner = relationship("User", back_populates="series")
    posts = relationship(
        "Post",
        back_populates="series",
        cascade="all, delete-orphan",
        order_by="Post.series_position",
    )
