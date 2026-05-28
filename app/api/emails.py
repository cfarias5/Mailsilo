from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import or_, func
from sqlalchemy.orm import Session

from app.database import get_session
from app.models import Email, Attachment, Account, DeletedEmail
from app.api.deps import get_current_user
from app.services.email_service import email_service

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/emails",
    tags=["emails"],
    dependencies=[Depends(get_current_user)],
)


@router.get("")
def list_emails(
    q: Optional[str] = Query(None),
    folder: Optional[str] = Query(None),
    account_id: Optional[int] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    sort_by: str = Query("date"),
    sort_order: str = Query("desc"),
    session: Session = Depends(get_session),
):
    query = session.query(Email)

    if q:
        tsquery = func.plainto_tsquery("spanish", q)
        query = query.filter(Email.search_vector.op("@@")(tsquery))

    if folder:
        query = query.filter(Email.folder == folder)
    if account_id:
        query = query.filter(Email.account_id == account_id)

    sort_col = {
        "date": Email.date,
        "subject": Email.subject,
        "sender": Email.sender_name,
        "created_at": Email.created_at,
    }.get(sort_by, Email.date)

    use_fts = bool(q)

    total = query.count()
    if q and total == 0:
        use_fts = False
        like = f"%{q}%"
        query = session.query(Email).filter(
            or_(
                Email.subject.ilike(like),
                Email.sender_name.ilike(like),
                Email.sender_email.ilike(like),
                Email.body_text.ilike(like),
            )
        )
        if folder:
            query = query.filter(Email.folder == folder)
        if account_id:
            query = query.filter(Email.account_id == account_id)
        total = query.count()

    if use_fts and sort_by == "date" and sort_order == "desc":
        tsquery = func.plainto_tsquery("spanish", q)
        order_expr = func.ts_rank(Email.search_vector, tsquery).desc()
    else:
        order_fn = sort_col.asc if sort_order == "asc" else sort_col.desc
        order_expr = order_fn().nullslast()

    offset = (page - 1) * per_page
    emails = (
        query.order_by(order_expr)
        .offset(offset)
        .limit(per_page)
        .all()
    )

    return {
        "total": total,
        "page": page,
        "per_page": per_page,
        "items": [
            {
                "id": e.id,
                "account_id": e.account_id,
                "folder": e.folder,
                "subject": e.subject,
                "sender_name": e.sender_name,
                "sender_email": e.sender_email,
                "date": e.date.isoformat() if e.date else None,
                "has_attachments": e.has_attachments,
                "is_read": e.is_read,
                "is_flagged": e.is_flagged,
                "is_imported": e.is_imported,
            }
            for e in emails
        ],
    }


@router.get("/export-mbox")
def export_mbox(
    q: Optional[str] = Query(None),
    folder: Optional[str] = Query(None),
    account_id: Optional[int] = Query(None),
    session: Session = Depends(get_session),
):
    from fastapi.responses import StreamingResponse

    query = email_service.get_export_query(q, folder, account_id, session)
    total = query.count()

    return StreamingResponse(
        email_service.generate_mbox_export(q, folder, account_id, session),
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="mailsilo-export-{total}emails.mbox"'
        },
    )


@router.get("/export-mbox-by-ids")
def export_mbox_by_ids(
    ids: str = Query(...),
    session: Session = Depends(get_session),
):
    from fastapi.responses import StreamingResponse
    id_list = [int(x) for x in ids.split(",") if x.strip()]
    total = len(id_list)

    return StreamingResponse(
        email_service.generate_mbox_export_by_ids(id_list, session),
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="mailsilo-export-{total}emails.mbox"'
        },
    )


@router.get("/{email_id}")
def get_email(email_id: int, session: Session = Depends(get_session)):
    email = session.query(Email).filter(Email.id == email_id).first()
    if not email:
        raise HTTPException(404, "Email not found")

    email.is_read = True
    session.commit()

    atts = session.query(Attachment).filter(Attachment.email_id == email.id).all()

    body_html = email.body_html or ""
    if atts and body_html:
        def _replace_cid(m: re.Match) -> str:
            cid = m.group(1)
            for a in atts:
                if a.content_id and a.content_id.strip("<>") == cid:
                    return f"/api/emails/{email.id}/attachment/{a.id}"
            return m.group(0)
        body_html = re.sub(r'cid:([^"\'\s&>]+)', _replace_cid, body_html)

    return {
        "id": email.id,
        "account_id": email.account_id,
        "folder": email.folder,
        "message_id": email.message_id,
        "subject": email.subject,
        "sender_name": email.sender_name,
        "sender_email": email.sender_email,
        "recipients_to": email.recipients_to,
        "recipients_cc": email.recipients_cc,
        "recipients_bcc": email.recipients_bcc,
        "date": email.date.isoformat() if email.date else None,
        "body_text": email.body_text,
        "body_html": body_html,
        "has_attachments": email.has_attachments,
        "is_read": email.is_read,
        "is_flagged": email.is_flagged,
        "attachments": [
            {"id": a.id, "filename": a.filename, "content_type": a.content_type, "content_id": a.content_id, "size": a.size}
            for a in atts
        ],
    }


@router.delete("/{email_id}")
def delete_email(email_id: int, session: Session = Depends(get_session)):
    if not email_service.delete_email(email_id, session):
        raise HTTPException(404, "Email not found")
    session.commit()
    return {"ok": True}


@router.post("/batch-delete")
def batch_delete_emails(
    body: dict,
    session: Session = Depends(get_session),
):
    ids = body.get("ids", [])
    if not ids:
        raise HTTPException(400, "No email IDs provided")
    deleted = 0
    for email_id in ids:
        if email_service.delete_email(email_id, session):
            deleted += 1
    session.commit()
    return {"deleted": deleted}


@router.get("/{email_id}/attachment/{attachment_id}")
def get_attachment(
    email_id: int,
    attachment_id: int,
    session: Session = Depends(get_session),
):
    att = (
        session.query(Attachment)
        .filter(Attachment.id == attachment_id, Attachment.email_id == email_id)
        .first()
    )
    if not att:
        raise HTTPException(404, "Attachment not found")
    from fastapi.responses import Response

    content = att.data
    if not content and att.file_path:
        try:
            with open(att.file_path, "rb") as f:
                content = f.read()
        except FileNotFoundError:
            raise HTTPException(404, "Attachment file not found on disk")

    return Response(
        content=content,
        media_type=att.content_type or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{att.filename}"'},
    )


@router.get("/{email_id}/export")
def export_eml(email_id: int, session: Session = Depends(get_session)):
    email = session.query(Email).filter(Email.id == email_id).first()
    if not email:
        raise HTTPException(404, "Email not found")
    raw = email.raw or email_service.build_eml(email)

    from fastapi.responses import Response

    filename = f"{email_id}-{email.subject[:60] or 'email'}.eml"
    safe_name = "".join(c if c.isalnum() or c in " .-_" else "_" for c in filename)
    return Response(
        content=raw,
        media_type="message/rfc822",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
    )


class ForwardRequest(BaseModel):
    to: str


@router.post("/{email_id}/forward")
def forward_email(
    email_id: int,
    data: ForwardRequest,
    session: Session = Depends(get_session),
):
    try:
        email_service.forward_email(email_id, data.to, session)
        return {"ok": True, "message": f"Correo reenviado a {data.to}"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
