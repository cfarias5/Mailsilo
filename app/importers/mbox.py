from __future__ import annotations

import hashlib
import logging
import mailbox
from pathlib import Path
from typing import Optional, Callable

from app.models import Email, Attachment, Account
from app.database import get_session

logger = logging.getLogger(__name__)

_DB_SUBJECT_MAX = 512
_DB_SHORT_MAX = 255
_DB_FILENAME_MAX = 512
_DB_CONTENT_TYPE_MAX = 255


def import_mbox(
    filepath: str | Path,
    account_id: int = 0,
    progress_cb: Callable[[int, int], None] | None = None,
) -> dict:
    p = Path(filepath)
    mbox = mailbox.mbox(str(p))
    total = len(mbox)
    session = get_session()
    count = 0
    errors = []
    first_sender = None
    resolved_id = 0
    if progress_cb:
        progress_cb(0, total)
    try:
        for key, msg in mbox.items():
            try:
                def hdr(name: str) -> str:
                    return _str_header(msg.get(name))

                msg_id = _str_header(msg.get("Message-ID", "")).strip()
                raw_bytes = msg.as_bytes()
                if not msg_id:
                    msg_id = "fallback-" + hashlib.sha256(raw_bytes).hexdigest()[:32]
                subject = _decode_mime(_str_header(msg.get("Subject", "")))
                sender_raw = _str_header(msg.get("From", ""))
                sender_name, sender_email = _parse_address(sender_raw)
                date = _parse_date(_str_header(msg.get("Date", "")))
                text, html = _get_body_eml(msg)
                attachments, part_errors = _get_attachments(msg)
                for pe in part_errors:
                    errors.append(f"msg {key}: {pe}")

                if account_id == 0:
                    if first_sender is None:
                        first_sender = sender_email or "importado"
                        acct_id = _ensure_account(session, first_sender)
                        resolved_id = acct_id
                    else:
                        acct_id = resolved_id
                else:
                    acct_id = account_id

                existing = (
                    session.query(Email)
                    .filter(Email.message_id == msg_id, Email.account_id == acct_id)
                    .first()
                )
                if not existing:
                    email_entry = Email(
                        account_id=acct_id,
                        folder="Imported",
                        message_id=_clean_str(msg_id, _DB_SUBJECT_MAX),
                        subject=_clean_str(subject, _DB_SUBJECT_MAX),
                        sender_name=_clean_str(sender_name, _DB_SHORT_MAX),
                        sender_email=_clean_str(sender_email, _DB_SHORT_MAX),
                        recipients_to=_clean_str(hdr("To")),
                        recipients_cc=_clean_str(hdr("Cc")),
                        recipients_bcc=_clean_str(hdr("Bcc")),
                        date=date,
                        received_date=date,
                        body_text=_truncate_body(_clean_str(text)),
                        body_html=_truncate_body(_clean_str(html)),
                        raw=raw_bytes,
                        has_attachments=len(attachments) > 0,
                        is_imported=True,
                        imported_from=_clean_str(p.name, _DB_SHORT_MAX),
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
                    count += 1
            except Exception as e:
                errors.append(f"msg {key}: {e}")

            if progress_cb and (count % 5 == 0 or count == total):
                progress_cb(count, total)

        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

    return {"imported": count, "errors": errors, "total": total}


def _str_header(val) -> str:
    """Convierte una cabecera MIME a texto (puede ser ``email.header.Header``)."""
    if val is None:
        return ""
    if isinstance(val, str):
        return val
    if isinstance(val, bytes):
        return val.decode("utf-8", errors="replace")
    try:
        return str(val)
    except Exception:
        return ""


def _clean_str(s: str, max_len: int | None = None) -> str:
    s = _str_header(s).replace("\x00", "")
    if max_len is not None and len(s) > max_len:
        s = s[:max_len]
    return s


def _clean_filename(filename: str) -> str:
    return _clean_str(filename, _DB_FILENAME_MAX) or "adjunto"


def _decode_mime(s: str | bytes | None) -> str:
    s = _str_header(s)
    if not s:
        return ""
    from email.header import decode_header

    try:
        parts = decode_header(s)
    except Exception:
        return s
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
    hdr = _str_header(hdr).strip()
    if "<" in hdr:
        name, addr = hdr.rsplit("<", 1)
        addr = addr.rstrip(">").strip()
        name = _decode_mime(name.strip().strip('"'))
        return name, addr
    return "", hdr


def _parse_date(date_str: str) -> Optional[datetime]:
    import email.utils
    from datetime import timezone

    date_str = _str_header(date_str).strip()
    if not date_str:
        return None
    try:
        parsed = email.utils.parsedate_to_datetime(date_str)
    except (TypeError, ValueError, OverflowError):
        logger.debug("Unparseable Date header: %r", date_str)
        return None
    if parsed and parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _truncate_body(s: str, max_chars: int = 500000) -> str:
    return s[:max_chars] if len(s) > max_chars else s


def _get_body_eml(msg) -> tuple[str, str]:
    text = ""
    html = ""
    if msg.is_multipart():
        for part in msg.walk():
            try:
                ct = part.get_content_type()
                if ct == "text/plain":
                    payload = part.get_payload(decode=True)
                    if payload:
                        text += payload.decode("utf-8", errors="replace")
                elif ct == "text/html":
                    payload = part.get_payload(decode=True)
                    if payload:
                        html += payload.decode("utf-8", errors="replace")
            except Exception as exc:
                logger.warning("No se pudo leer una parte del cuerpo: %s", exc)
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            decoded = payload.decode("utf-8", errors="replace")
            if msg.get_content_type() == "text/html":
                html = decoded
            else:
                text = decoded
    return text, html


def _get_attachments(msg) -> tuple[list[tuple[str, str, str, bytes]], list[str]]:
    attachments: list[tuple[str, str, str, bytes]] = []
    errors: list[str] = []
    if not msg.is_multipart():
        return attachments, errors

    for part in msg.walk():
        try:
            if part.get_content_maintype() == "multipart":
                continue
            ct = _str_header(part.get_content_type())
            disp = _str_header(part.get("Content-Disposition")).lower()
            cid = _str_header(part.get("Content-ID")).strip().strip("<>").strip()
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
                attachments.append(
                    (
                        _clean_filename(filename),
                        _clean_str(ct, _DB_CONTENT_TYPE_MAX),
                        _clean_str(cid, _DB_SHORT_MAX),
                        payload,
                    )
                )
        except Exception as exc:
            logger.warning("No se pudo procesar un adjunto del MBOX: %s", exc)
            errors.append(f"adjunto descartado: {exc}")

    return attachments, errors


def _ensure_account(session, sender_email: str) -> int:
    sender_email = _clean_str(sender_email, _DB_SHORT_MAX)
    if not sender_email:
        return 0
    acct = session.query(Account).filter(Account.email == sender_email).first()
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
