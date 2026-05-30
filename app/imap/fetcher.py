from __future__ import annotations

import email
import hashlib
import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from email.header import decode_header
from typing import Optional

from bs4 import BeautifulSoup
from imapclient import IMAPClient

from app.database import get_session
from app.models import Account, Email, Attachment, Folder, DeletedEmail
from app.models.attachment import ATTACHMENT_STORAGE

logger = logging.getLogger(__name__)

FETCH_PROGRESS_DIR = "/tmp/mailsilo_fetch"
MAX_EMAIL_SIZE = 25 * 1024 * 1024  # 25 MB
BATCH_SIZE = 50


class FetchCancelled(Exception):
    pass


# =========================================================
# PROGRESS / CANCEL
# =========================================================


def _write_progress(account_id: int, current: int, total: int, folder: str, total_fetched: int = 0, year: int | None = None, year_current: int = 0, year_total: int = 0):
    from app.services.fetch import fetch_service
    payload = {
        "status": "running",
        "current": current,
        "total": total,
        "folder": folder,
        "total_fetched": total_fetched,
    }
    if year is not None:
        payload["year"] = year
        payload["year_current"] = year_current
        payload["year_total"] = year_total
    fetch_service.set_progress(account_id, payload)
    # También imprimir a stdout para que el padre lo capture línea por línea
    print(f"PROGRESS:{json.dumps(payload)}", flush=True)


def _clear_progress(account_id: int):
    # Ya no necesitamos archivos, el estado se maneja en Redis a través de set_status
    pass


def _is_cancelled(account_id: int) -> bool:
    from app.services.fetch import fetch_service
    status = fetch_service.get_status(account_id)
    return status.get("status") == "cancelled"


def _check_cancelled(account_id: int):
    if _is_cancelled(account_id):
        logger.info("Fetch cancelled for account %d", account_id)
        raise FetchCancelled()


# =========================================================
# MIME DECODING
# =========================================================


def _decode_mime(s: str | bytes | None) -> str:
    if s is None:
        return ""
    if isinstance(s, bytes):
        s = s.decode("utf-8", errors="replace")
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


def _decode_payload(payload: bytes, part) -> str:
    charset = (part.get_content_charset() or "utf-8").lower()
    for cs in [charset, "utf-8", "latin-1", "cp1252", "iso-8859-1"]:
        try:
            return payload.decode(cs, errors="replace")
        except (LookupError, UnicodeDecodeError, ValueError):
            continue
    return payload.decode("utf-8", errors="replace")


def _parse_address(hdr: str) -> tuple[str, str]:
    hdr = hdr.strip()
    if "<" in hdr:
        name, addr = hdr.rsplit("<", 1)
        addr = addr.rstrip(">").strip()
        name = _decode_mime(name.strip().strip('"'))
        return name, addr
    return "", hdr


def _sanitize(s: str) -> str:
    return s.replace("\x00", "")


def _get_msg_id(msg: email.message.Message) -> str:
    mid = str(msg.get("Message-ID", "") or "")
    return mid.strip()


def _make_fallback_id(raw_bytes: bytes) -> str:
    return hashlib.sha256(raw_bytes).hexdigest()[:32]


def _parse_date(date_str: str) -> Optional[datetime]:
    if not date_str:
        return None
    parsed = email.utils.parsedate_to_datetime(date_str)
    if parsed and parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


# =========================================================
# BODY PARSER
# =========================================================


def _get_body(msg: email.message.Message) -> tuple[str, str]:
    text = ""
    html = ""
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            disp = str(part.get("Content-Disposition") or "").lower()
            if "attachment" in disp:
                continue
            if part.get_content_maintype() == "multipart":
                continue
            payload = part.get_payload(decode=True)
            if not payload:
                continue
            if ct == "text/plain":
                text += _decode_payload(payload, part)
            elif ct == "text/html":
                html += _decode_payload(payload, part)
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            ct = msg.get_content_type()
            decoded = _decode_payload(payload, msg)
            if ct == "text/html":
                html = decoded
            else:
                text = decoded
    if html:
        html = sanitize_html(html)
    return text, html


def sanitize_html(html_str: str) -> str:
    if not html_str:
        return html_str
    import warnings
    from bs4 import XMLParsedAsHTMLWarning
    warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)
    soup = BeautifulSoup(html_str, "html.parser")
    for tag in soup(["script", "style", "iframe", "object", "embed", "noscript"]):
        tag.decompose()
    for tag in soup.find_all(True):
        for attr in list(tag.attrs):
            if attr.startswith("on"):
                del tag[attr]
            if attr in ("style", "class", "id", "width", "height", "align", "border", "cellpadding", "cellspacing", "bgcolor"):
                continue
            if attr.startswith("data-") or attr.startswith("aria-"):
                continue
            if attr not in ("href", "src", "alt", "title", "target", "rel", "type", "name", "colspan", "rowspan", "valign"):
                del tag[attr]
    return str(soup)


# =========================================================
# ATTACHMENT PARSER
# =========================================================


def _get_attachments(msg: email.message.Message) -> list[tuple[str, str, str, bytes]]:
    attachments = []
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_maintype() == "multipart":
                continue
            ct = part.get_content_type()
            disp = str(part.get("Content-Disposition") or "").lower()
            cid = str(part.get("Content-ID") or "").strip("<>").strip()
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


# =========================================================
# ATTACHMENT DISK STORAGE
# =========================================================


def _save_attachment(email_id: int, filename: str, payload: bytes) -> str:
    dirpath = os.path.join(ATTACHMENT_STORAGE, str(email_id))
    os.makedirs(dirpath, exist_ok=True)
    unique_name = f"{uuid.uuid4().hex[:12]}_{filename}"
    filepath = os.path.join(dirpath, unique_name)
    with open(filepath, "wb") as f:
        f.write(payload)
    return filepath


def _delete_attachment_files(email_id: int):
    dirpath = os.path.join(ATTACHMENT_STORAGE, str(email_id))
    try:
        import shutil
        shutil.rmtree(dirpath)
    except FileNotFoundError:
        pass


# =========================================================
# FOLDER UID TRACKING
# =========================================================


def _get_folder_state(account_id: int, folder_name: str) -> tuple[Optional[int], Optional[int]]:
    last_email = (
        get_session()
        .query(Email)
        .filter(Email.account_id == account_id, Email.folder == folder_name, Email.uid.isnot(None))
        .order_by(Email.uid.desc())
        .first()
    )
    uidvalidity = None
    if last_email:
        uidvalidity = last_email.uidvalidity
    return (last_email.uid if last_email else None, uidvalidity)


# =========================================================
# FOLDER FETCH
# =========================================================


def _fetch_folder(client: IMAPClient, account: Account, folder_name: str, total_so_far: int = 0) -> int:
    _check_cancelled(account.id)
    logger.info("Fetching folder %s for account %d", folder_name, account.id)

    select_resp = client.select_folder(folder_name, readonly=True)
    uidvalidity = select_resp.get(b"UIDVALIDITY")
    if isinstance(uidvalidity, bytes):
        uidvalidity = int(uidvalidity)

    all_uids = client.search(["NOT", "DELETED"])
    if not all_uids:
        logger.info("No messages in folder %s", folder_name)
        return 0

    total_msgs = len(all_uids)

    # --- incremental UID sync ---
    last_uid, stored_uidvalidity = _get_folder_state(account.id, folder_name)
    if last_uid and stored_uidvalidity == uidvalidity:
        new_uids = [u for u in all_uids if u > last_uid]
        if not new_uids:
            logger.info("No new messages in %s (last UID %d)", folder_name, last_uid)
            return 0
        logger.info("Incremental fetch: %d new UIDs (last was %d)", len(new_uids), last_uid)
        year_chunks: list[tuple[int | None, list[int]]] = [(None, new_uids)]
    else:
        logger.info("Full folder fetch: %d messages", total_msgs)
        year_chunks = [(None, list(all_uids))]

    session = get_session()
    count = 0

    try:
        fetch_uids = year_chunks[0][1]
        total_to_fetch = len(fetch_uids)

        for i in range(0, total_to_fetch, BATCH_SIZE):
            _check_cancelled(account.id)
            batch = fetch_uids[i : i + BATCH_SIZE]

            responses = client.fetch(
                batch,
                ["BODY.PEEK[HEADER]", "RFC822.SIZE"],
            )

            # Separate new vs duplicate
            new_uids_batch: list[int] = []
            existing_ids: set[str] = set()

            for uid_val, data in responses.items():
                if data.get(b"RFC822.SIZE", 0) > MAX_EMAIL_SIZE:
                    logger.warning("Skipping UID %d — size %d exceeds limit", uid_val, data.get(b"RFC822.SIZE", 0))
                    continue

                header_raw = data.get(b"BODY[HEADER]")
                if not header_raw:
                    continue

                hdr_msg = email.message_from_bytes(header_raw)
                msg_id = _get_msg_id(hdr_msg)
                if not msg_id:
                    msg_id = _make_fallback_id(header_raw)

                exists = (
                    session.query(Email)
                    .filter(
                        Email.account_id == account.id,
                        Email.message_id == msg_id,
                        Email.folder == folder_name,
                    )
                    .first()
                )
                if exists:
                    existing_ids.add(msg_id)
                    if exists.uid is None:
                        exists.uid = uid_val
                        exists.uidvalidity = uidvalidity
                    continue

                was_deleted = (
                    session.query(DeletedEmail)
                    .filter(
                        DeletedEmail.account_id == account.id,
                        DeletedEmail.message_id == msg_id,
                        DeletedEmail.folder == folder_name,
                    )
                    .first()
                )
                if was_deleted:
                    continue

                new_uids_batch.append(uid_val)

            if new_uids_batch:
                body_responses = client.fetch(new_uids_batch, ["BODY.PEEK[]"])

                for uid_val in new_uids_batch:
                    body_data = body_responses.get(uid_val, {})
                    raw_bytes = body_data.get(b"BODY[]")
                    if not raw_bytes:
                        continue

                    msg = email.message_from_bytes(raw_bytes)

                    subject = _decode_mime(msg.get("Subject", ""))
                    sender_raw = str(msg.get("From", ""))
                    sender_name, sender_email = _parse_address(sender_raw)
                    to_raw = str(msg.get("To", ""))
                    cc_raw = str(msg.get("Cc", ""))
                    bcc_raw = str(msg.get("Bcc", ""))
                    date_str = str(msg.get("Date", "") or "")
                    date = _parse_date(date_str)
                    text, html = _get_body(msg)
                    attachments_list = _get_attachments(msg)

                    hdr_msg2 = email.message_from_bytes(raw_bytes)
                    msg_id = _get_msg_id(hdr_msg2)
                    if not msg_id:
                        msg_id = _make_fallback_id(raw_bytes)

                    email_entry = Email(
                        account_id=account.id,
                        folder=folder_name,
                        uid=uid_val,
                        uidvalidity=uidvalidity,
                        message_id=msg_id,
                        subject=_sanitize(subject),
                        sender_name=_sanitize(sender_name),
                        sender_email=_sanitize(sender_email),
                        recipients_to=_sanitize(to_raw),
                        recipients_cc=_sanitize(cc_raw),
                        recipients_bcc=_sanitize(bcc_raw),
                        date=date,
                        received_date=date,
                        body_text=_sanitize(text),
                        body_html=_sanitize(html),
                        raw=raw_bytes,
                        has_attachments=len(attachments_list) > 0,
                        is_read=False,
                        is_flagged=False,
                        is_imported=False,
                    )
                    session.add(email_entry)
                    session.flush()

                    for fname, ctype, cid, payload in attachments_list:
                        file_path = _save_attachment(email_entry.id, fname, payload) if payload else None
                        att = Attachment(
                            email_id=email_entry.id,
                            filename=fname,
                            content_type=ctype,
                            content_id=cid,
                            size=len(payload) if payload else 0,
                            data=payload,
                            file_path=file_path,
                        )
                        session.add(att)

                    count += 1

            session.commit()
            _write_progress(
                account.id,
                i + len(batch), total_to_fetch, folder_name, total_so_far + count,
            )

        logger.info("Folder %s done: %d new emails", folder_name, count)
    except FetchCancelled:
        session.rollback()
        raise
    except Exception:
        session.rollback()
        logger.exception("Error fetching folder %s", folder_name)
        raise
    finally:
        session.close()

    return count


# =========================================================
# MAIN FETCH
# =========================================================


def _microsoft_access_token(account: Account) -> str | None:
    from app.api.oauth_microsoft import refresh_microsoft_token
    return refresh_microsoft_token(account)


def _connect_imap(account: Account) -> IMAPClient:
    import socket
    server = account.imap_server
    port = account.imap_port or 993
    use_ssl = account.imap_use_ssl
    username = account.username or account.email

    orig_getaddrinfo = socket.getaddrinfo
    def _ipv4_getaddrinfo(h, p, family=0, type=0, proto=0, flags=0):
        return orig_getaddrinfo(h, p, socket.AF_INET, type, proto, flags)
    socket.getaddrinfo = _ipv4_getaddrinfo
    try:
        client = IMAPClient(server, use_uid=True, ssl=use_ssl, port=port, timeout=30)
    finally:
        socket.getaddrinfo = orig_getaddrinfo

    if account.uses_oauth:
        if account.oauth_provider == "microsoft":
            access_token = _microsoft_access_token(account)
            if not access_token:
                raise ConnectionError(f"No se pudo obtener token OAuth para {account.email}")
            try:
                client.oauth2_login(account.email, access_token)
                logger.info("Connected via OAuth to %s", server)
            except Exception as e:
                raise ConnectionError(f"OAuth login failed for {server}:{port} — {e}")
        else:
            raise ConnectionError(f"Proveedor OAuth no soportado: {account.oauth_provider}")
    else:
        from app.crypto import decrypt
        password = decrypt(account.password_encrypted)
        try:
            client.login(username, password)
            logger.info("Connected to %s", server)
        except Exception as e:
            raise ConnectionError(f"Cannot connect to {server}:{port} — {e}")

    return client


def fetch_account(account: Account) -> int:
    _clear_progress(account.id)
    _write_progress(account.id, 0, 0, "Conectando...", 0)
    logger.info("Fetching account %s (%s)", account.email, account.imap_server)

    client = _connect_imap(account)

    # Discover all server folders but only sync the ones the user selected
    server_folders = _list_folders_from_client(client)
    selected = set(account.folder_list())

    if not server_folders:
        logger.warning("No folders found on server, using saved list")
        to_sync = list(selected)
    else:
        # Persist the full server list so the UI can show available folders
        saved = ",".join(server_folders)
        if account.folders != saved:
            account.folders = saved
            from app.database import get_session
            sess = get_session()
            try:
                sess.merge(account)
                sess.commit()
            finally:
                sess.close()
        # Only sync folders the user explicitly chose
        to_sync = [f for f in server_folders if f in selected]
        new_folders = [f for f in server_folders if f not in selected]
        if new_folders:
            logger.info("Discovered but not synced: %s", new_folders)

    total = 0
    try:
        for folder_name in to_sync:
            try:
                total += _fetch_folder(client, account, folder_name, total)
            except FetchCancelled:
                raise
            except Exception as e:
                logger.error("Failed fetching folder %s: %s", folder_name, e)
                continue
    except FetchCancelled:
        logger.info("Fetch cancelled for account %d", account.id)
    finally:
        try:
            client.logout()
        except Exception:
            pass

    return total


def fetch_all_accounts() -> dict[str, int]:
    from app.models import Account

    results = {}
    session = get_session()
    try:
        accounts = session.query(Account).filter(Account.enabled == True).all()
        for acct in accounts:
            try:
                n = fetch_account(acct)
                results[acct.email] = n
                acct.last_fetch = datetime.now(timezone.utc)
                session.commit()
            except Exception as e:
                logger.error("Fetch all — account %s failed: %s", acct.email, e)
                results[acct.email] = -1
    finally:
        session.close()
    return results


# =========================================================
# FOLDER LISTING
# =========================================================


def _list_folders_from_client(client: IMAPClient) -> list[str]:
    seen: set[str] = set()
    folders: list[str] = []

    def _add(raw_list):
        for flags, delimiter, name in raw_list:
            if not name or name in seen:
                continue
            seen.add(name)
            folders.append(name)

    _add(client.list_folders())

    try:
        _add(client.list_subscribed_folders())
    except Exception:
        pass

    try:
        _add(client.list_folders("", "%"))
    except Exception:
        pass

    try:
        _add(client.list_folders("INBOX.", "*"))
    except Exception:
        pass

    folders.sort()
    return folders


def list_folders(server: str, port: int = 993, use_ssl: bool = True, username: str = "", password: str = "", account: Account | None = None) -> list[str]:
    try:
        import socket
        orig_getaddrinfo = socket.getaddrinfo
        def _ipv4_getaddrinfo(h, p, family=0, type=0, proto=0, flags=0):
            return orig_getaddrinfo(h, p, socket.AF_INET, type, proto, flags)
        socket.getaddrinfo = _ipv4_getaddrinfo
        try:
            client = IMAPClient(server, use_uid=True, ssl=use_ssl, port=port, timeout=30)
        finally:
            socket.getaddrinfo = orig_getaddrinfo

        if account and account.uses_oauth:
            from app.api.oauth_microsoft import refresh_microsoft_token
            if account.oauth_provider == "microsoft":
                token = refresh_microsoft_token(account)
                if not token:
                    raise ConnectionError("No se pudo obtener token OAuth")
                client.oauth2_login(account.email, token)
        else:
            client.login(username, password)

        folders = _list_folders_from_client(client)
        client.logout()
        return folders
    except Exception as e:
        logger.error("Failed to list folders: %s", e)
        raise
