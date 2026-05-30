from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class BotInstance(Base):
    __tablename__ = "bot_instances"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    instance_id: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    token_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    invite_url: Mapped[str] = mapped_column(Text, default="", nullable=False)
    active_guild_limit: Mapped[int] = mapped_column(Integer, default=20, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)
    active_guild_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)


class License(Base):
    __tablename__ = "licenses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    license_id: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    key_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)
    plan: Mapped[str] = mapped_column(String(64), default="basic", nullable=False)
    max_guilds: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    feature_flags: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    limits: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    note: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    assignments: Mapped[list["GuildAssignment"]] = relationship(back_populates="license")


class GuildAssignment(Base):
    __tablename__ = "guild_assignments"
    __table_args__ = (UniqueConstraint("guild_id", name="uq_guild_assignments_guild_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    guild_id: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    guild_name: Mapped[str] = mapped_column(Text, default="", nullable=False)
    assigned_bot_instance_id: Mapped[str] = mapped_column(String(100), ForeignKey("bot_instances.instance_id"), nullable=False)
    license_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("licenses.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="activation_only", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    license: Mapped[License | None] = relationship(back_populates="assignments")
