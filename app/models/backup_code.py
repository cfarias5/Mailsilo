from __future__ import annotations

from datetime import datetime, timezone
from sqlalchemy import String, DateTime, Integer, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class BackupCode(Base):
    __tablename__ = "backup_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    code_hash: Mapped[str] = mapped_column(String(128))
    used: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
