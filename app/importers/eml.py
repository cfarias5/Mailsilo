from __future__ import annotations

import hashlib
import email
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional

from app.models import Email, Attachment, Account
from app.database import get_session


def _str_header(val) -> str:
    if val is None: return ""
    if isinstance(val, str): return val
    try: return str(val)
    except: return ""

def _clean_str(s: str) -> str:
    return s.replace("\x00", "")

def _truncate_body(s: str, max_chars: int = 500000) -> str:
    return s[:max_chars] if len(s) > max_chars else s

def _decode_mime(s: str | bytes | None) -> str:
    if s is None:
        return ""
    if isinstance(s, bytes):
        s = s.decode("utf-8", errors="replace")
    from email.header import decode_header

    parts = decode_header(s)
    out = []
    for part, charset in parts:
        if isinstance(part, bytes):
            cs = charset or "utf-8"
            try:
                out.append(part.decode(cs, errors="replace"))
            except (LookupError, UnicodeDecodeError):
                out.append(part.decode("utf-8", errors="replace"))
        else:
            out.append(str(part))
    return " ".join(out)


def _parse_address(hdr: str) -> tuple[str, str]:
    hdr = hdr.strip()
    if "<" in hdr:
        name, addr = hdr.rsplit("<", 1)
        addr = addr.rstrip(">").strip()
        name = _decode_mime(name.strip().strip('"'))
        return name, addr
    return "", hdr


def _parse_date(date_str: str) -> Optional[datetime]:
    if not date_str:
        return None
    parsed = email.utils.parsedate_to_datetime(date_str)
    if parsed and parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _get_body(msg: email.message.Message) -> tuple[str, str]:
    text = ""
    html = ""
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            if ct == "text/plain":
                payload = part.get_payload(decode=True)
                if payload:
                    text += payload.decode("utf-8", errors="replace")
            elif ct == "text/html":
                payload = part.get_payload(decode=True)
                if payload:
                    html += payload.decode("utf-8", errors="replace")
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            decoded = payload.decode("utf-8", errors="replace")
            if msg.get_content_type() == "text/html":
                html = decoded
            else:
                text = decoded
    return text, html


def _get_attachments(msg: email.message.Message) -> list[tuple[str, str, str, bytes]]:
    attachments = []
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_maintype() == "multipart":
                continue
            ct = part.get_content_type()
            disp = (part.get("Content-Disposition") or "").lower()
            cid = (part.get("Content-ID") or "").strip("<>").strip()
            is_inline_image = ct.startswith("image/") and (cid or "inline" in disp)
            is_attachment = "attachment" in disp
            if not is_inline_image and not is_attachment:
                continue
            filename = part.get_filename()
            if filename:
                filename = _decode_mime(filename)
            elif cid:
                filename = cid
            else:
                filename = "inline_image"
            payload = part.get_payload(decode=True)
            if payload:
                attachments.append((filename, ct, cid, payload))
    return attachments


def _ensure_account(session, sender_email: str) -> int:
    if not sender_email:
        return 0
    acct = (
        session.query(Account)
        .filter(Account.email == sender_email)
        .first()
    )
    if acct:
        return acct.id
    domain = sender_email.split("@")[-1] if "@" in sender_email else "unknown"
    acct = Account(
        name=sender_email,
        email=sender_email,
        imap_server=f"mail.{domain}",
        imap_port=993,
        imap_use_ssl=True,
        username=sender_email,
        folders="INBOX",
        enabled=False,
        is_imported=True,
    )
    session.add(acct)
    session.flush()
    return acct.id


def import_eml(filepath: str | Path, account_id: int = 0) -> int:
    p = Path(filepath)
    raw_bytes = p.read_bytes()
    msg = email.message_from_bytes(raw_bytes)

    msg_id = (_str_header(msg.get("Message-ID", "")) or "").strip()
    if not msg_id:
        msg_id = "fallback-" + hashlib.sha256(raw_bytes).hexdigest()[:32]
    subject = _decode_mime(_str_header(msg.get("Subject", "")))
    sender_raw = _str_header(msg.get("From", ""))
    sender_name, sender_email = _parse_address(sender_raw)
    date = _parse_date(_str_header(msg.get("Date", "")))
    text, html = _get_body(msg)
    attachments = _get_attachments(msg)

    session = get_session()
    count = 0
    try:
        if account_id == 0 and sender_email:
            account_id = _ensure_account(session, sender_email)

        existing = (
            session.query(Email)
            .filter(Email.message_id == msg_id, Email.account_id == account_id)
            .first()
        )
        if not existing:
            email_entry = Email(
                account_id=account_id,
                folder="Imported",
                message_id=msg_id,
                subject=_clean_str(subject),
                sender_name=_clean_str(sender_name),
                sender_email=_clean_str(sender_email),
                recipients_to=_clean_str(_str_header(msg.get("To", ""))),
                recipients_cc=_clean_str(_str_header(msg.get("Cc", ""))),
                recipients_bcc=_clean_str(_str_header(msg.get("Bcc", ""))),
                date=date,
                received_date=date,
                body_text=_truncate_body(_clean_str(text)),
                body_html=_truncate_body(_clean_str(html)),
                raw=raw_bytes,
                has_attachments=len(attachments) > 0,
                is_imported=True,
                imported_from=p.name,
            )
            session.add(email_entry)
            session.flush()

            for fname, ctype, cid, payload in attachments:
                att = Attachment(
                    email_id=email_entry.id,
                    filename=fname,
                    content_type=ctype,
                    content_id=cid,
                    size=len(payload),
                    data=payload,
                )
                session.add(att)
            count = 1

        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

    return count
