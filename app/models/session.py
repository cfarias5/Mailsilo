from __future__ import annotations

from datetime import datetime, timezone, timedelta
from sqlalchemy import String, DateTime, Integer, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

SESSION_TTL_DAYS = 7


def _default_expiry() -> datetime:
    return (datetime.now(timezone.utc) + timedelta(days=SESSION_TTL_DAYS)).replace(tzinfo=None)


class SessionToken(Base):
    __tablename__ = "session_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    token: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime, default=_default_expiry
    )
