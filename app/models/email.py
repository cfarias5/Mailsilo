from __future__ import annotations

from datetime import datetime, timezone
from sqlalchemy import String, Text, DateTime, Integer, Boolean, LargeBinary
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Email(Base):
    __tablename__ = "emails"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    account_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    folder: Mapped[str] = mapped_column(String(255), default="INBOX", index=True)
    uid: Mapped[int | None] = mapped_column(Integer, nullable=True)
    uidvalidity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    message_id: Mapped[str] = mapped_column(String(512), default="", index=True)
    subject: Mapped[str] = mapped_column(String(512), default="")
    sender_name: Mapped[str] = mapped_column(String(255), default="")
    sender_email: Mapped[str] = mapped_column(String(255), default="", index=True)
    recipients_to: Mapped[str] = mapped_column(Text, default="")
    recipients_cc: Mapped[str] = mapped_column(Text, default="")
    recipients_bcc: Mapped[str] = mapped_column(Text, default="")
    date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    received_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    body_text: Mapped[str] = mapped_column(Text, default="")
    body_html: Mapped[str] = mapped_column(Text, default="")
    raw: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    has_attachments: Mapped[bool] = mapped_column(Boolean, default=False)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    is_flagged: Mapped[bool] = mapped_column(Boolean, default=False)
    is_imported: Mapped[bool] = mapped_column(Boolean, default=False)
    imported_from: Mapped[str] = mapped_column(String(255), default="")
    search_vector: Mapped[str | None] = mapped_column(TSVECTOR, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
