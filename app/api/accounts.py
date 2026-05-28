from __future__ import annotations

import json
import os
import sys
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    HTTPException,
    Query,
    Request,
)
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, EmailStr
from sqlalchemy import func as sa_func
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.oauth_microsoft import PENDING_OAUTH_TOKENS
from app.database import get_session
from app.models import Email, Account, Attachment
from app.api.deps import get_current_user
from app.services.fetch import fetch_service
from app.crypto import encrypt, decrypt

router = APIRouter(
    prefix="/api/accounts",
    tags=["accounts"],
    dependencies=[Depends(get_current_user)],
)

BATCH_DELETE_TASKS: dict[str, dict] = {}
BATCH_DELETE_LOCK = threading.Lock()

class FetchStatusModel(BaseModel):
    status: str
    message: str = ""
    fetched: int = 0
    started_at: str | None = None
    finished_at: str | None = None
    progress: dict | None = None

class AccountCreate(BaseModel):
    name: str
    email: EmailStr
    imap_server: str
    imap_port: int = 993
    imap_use_ssl: bool = True
    username: str = ""
    password: str = ""
    folders: str = "INBOX"
    sync_interval: str = ""
    smtp_server: str = ""
    smtp_port: int = 587
    smtp_use_ssl: bool = True
    smtp_username: str = ""
    smtp_password: str = ""


class AccountUpdate(BaseModel):
    name: str | None = None
    imap_server: str | None = None
    imap_port: int | None = None
    imap_use_ssl: bool | None = None
    username: str | None = None
    password: str | None = None
    folders: str | None = None
    enabled: bool | None = None
    sync_interval: str | None = None
    smtp_server: str | None = None
    smtp_port: int | None = None
    smtp_use_ssl: bool | None = None
    smtp_username: str | None = None
    smtp_password: str | None = None


class FolderTestRequest(BaseModel):
    imap_server: str
    imap_port: int = 993
    imap_use_ssl: bool = True
    username: str = ""
    password: str = ""


@router.get("")
def list_accounts(session: Session = Depends(get_session)):
    accounts = session.query(Account).order_by(Account.email).all()
    counts = dict(
        session.query(Email.account_id, sa_func.count(Email.id))
        .filter(Email.account_id.isnot(None))
        .group_by(Email.account_id)
        .all()
    )
    return [
        {
            "id": a.id,
            "name": a.name,
            "email": a.email,
            "imap_server": a.imap_server,
            "imap_port": a.imap_port,
            "imap_use_ssl": a.imap_use_ssl,
            "username": a.username,
            "folders": a.folder_list(),
            "enabled": a.enabled,
            "is_imported": a.is_imported,
            "oauth_provider": a.oauth_provider,
            "last_fetch": a.last_fetch.isoformat() if a.last_fetch else None,
            "email_count": counts.get(a.id, 0),
            "sync_interval": a.sync_interval or "",
            "smtp_server": a.smtp_server or "",
            "smtp_port": a.smtp_port or 587,
            "smtp_use_ssl": a.smtp_use_ssl if a.smtp_use_ssl is not None else True,
            "smtp_username": a.smtp_username or "",
        }
        for a in accounts
    ]


@router.post("")
def create_account(data: AccountCreate, session: Session = Depends(get_session)):
    existing = session.query(Account).filter(Account.email == data.email).first()
    if existing:
        raise HTTPException(status_code=409, detail="Account already exists")

    acct = Account(
        name=data.name,
        email=data.email,
        imap_server=data.imap_server,
        imap_port=data.imap_port,
        imap_use_ssl=data.imap_use_ssl,
        username=data.username,
        password_encrypted=encrypt(data.password),
        folders=data.folders,
        sync_interval=data.sync_interval or None,
        smtp_server=data.smtp_server or None,
        smtp_port=data.smtp_port,
        smtp_use_ssl=data.smtp_use_ssl,
        smtp_username=data.smtp_username or None,
        smtp_password_encrypted=encrypt(data.smtp_password) if data.smtp_password else None,
    )
    session.add(acct)
    session.commit()
    session.refresh(acct)

    email_lower = data.email.lower().strip()
    oauth_tokens = PENDING_OAUTH_TOKENS.pop(email_lower, None)
    if oauth_tokens:
        acct.oauth_provider = oauth_tokens["provider"]
        acct.oauth_refresh_token = oauth_tokens.get("refresh_token", "")
        expiry_str = oauth_tokens.get("expiry")
        if expiry_str:
            try:
                acct.oauth_token_expiry = datetime.fromisoformat(expiry_str)
            except Exception:
                pass
        session.commit()

    return {"ok": True, "id": acct.id, "email": acct.email}


@router.put("/{account_id}")
def update_account(account_id: int, data: AccountUpdate, session: Session = Depends(get_session)):
    acct = session.query(Account).filter(Account.id == account_id).first()
    if not acct:
        raise HTTPException(status_code=404, detail="Account not found")

    update_data = data.model_dump(exclude_unset=True)

    if acct.is_imported:
        update_data.pop("sync_interval", None)
        update_data["enabled"] = False

    if "password" in update_data:
        update_data["password_encrypted"] = encrypt(update_data.pop("password"))

    if "smtp_password" in update_data:
        val = update_data.pop("smtp_password")
        if val:
            update_data["smtp_password_encrypted"] = encrypt(val)
        else:
            update_data["smtp_password_encrypted"] = None

    if "sync_interval" in update_data:
        update_data["sync_interval"] = update_data["sync_interval"] or None
    if "smtp_server" in update_data:
        update_data["smtp_server"] = update_data["smtp_server"] or None
    if "smtp_username" in update_data:
        update_data["smtp_username"] = update_data["smtp_username"] or None

    for key, value in update_data.items():
        setattr(acct, key, value)

    session.commit()

    email_lower = acct.email.lower().strip()
    oauth_tokens = PENDING_OAUTH_TOKENS.pop(email_lower, None)
    if oauth_tokens:
        acct.oauth_provider = oauth_tokens["provider"]
        acct.oauth_refresh_token = oauth_tokens.get("refresh_token", "")
        expiry_str = oauth_tokens.get("expiry")
        if expiry_str:
            try:
                acct.oauth_token_expiry = datetime.fromisoformat(expiry_str)
            except Exception:
                pass
        session.commit()

    return {"ok": True}


@router.delete("/{account_id}")
def delete_account(account_id: int, delete_emails: bool = Query(False), session: Session = Depends(get_session)):
    acct = session.query(Account).filter(Account.id == account_id).first()
    if not acct:
        raise HTTPException(status_code=404, detail="Account not found")

    if delete_emails:
        from app.models import Attachment, DeletedEmail
        query = session.query(Email.id).filter(Email.account_id == account_id).yield_per(1000)
        batch = []
        for row in query:
            batch.append(row[0])
            if len(batch) >= 1000:
                session.query(Attachment).filter(Attachment.email_id.in_(batch)).delete(synchronize_session=False)
                session.query(Email).filter(Email.id.in_(batch)).delete(synchronize_session=False)
                batch.clear()
        if batch:
            session.query(Attachment).filter(Attachment.email_id.in_(batch)).delete(synchronize_session=False)
            session.query(Email).filter(Email.id.in_(batch)).delete(synchronize_session=False)
        session.query(DeletedEmail).filter(DeletedEmail.account_id == account_id).delete(synchronize_session=False)

    from app.models import Folder
    session.query(Folder).filter(Folder.account_id == account_id).delete(synchronize_session=False)
    session.delete(acct)
    session.commit()
    return {"ok": True}


@router.post("/batch-delete")
def batch_delete_accounts(body: dict, session: Session = Depends(get_session)):
    ids = body.get("ids", [])
    delete_emails = body.get("delete_emails", False)
    if not ids:
        raise HTTPException(status_code=400, detail="No account IDs provided")

    existing = session.query(Account.id).filter(Account.id.in_(ids)).all()
    existing_ids = [r[0] for r in existing]
    if not existing_ids:
        raise HTTPException(status_code=404, detail="No accounts found")

    task_id = str(uuid.uuid4())
    BATCH_DELETE_TASKS[task_id] = {
        "status": "running",
        "total": len(existing_ids),
        "deleted": 0,
        "current": 0,
    }

    thread = threading.Thread(
        target=_background_batch_delete,
        args=(task_id, existing_ids, delete_emails),
        daemon=True,
    )
    thread.start()
    return {"task_id": task_id, "total": len(existing_ids)}


def _background_batch_delete(task_id: str, ids: list[int], delete_emails: bool):
    from app.models import Attachment, DeletedEmail, Folder
    session = get_session()
    total_accts = len(ids)
    EMAIL_BATCH = 500
    task = BATCH_DELETE_TASKS.get(task_id)

    steps = 2
    if delete_emails:
        email_count = session.query(Email.id).filter(Email.account_id.in_(ids)).count()
        total_work = email_count + steps
        label = "correos"
    else:
        total_work = steps
        label = "cuentas"

    task["total"] = total_work
    task["label"] = label
    task["phase"] = "Preparando..."
    progress = 0

    try:
        if delete_emails:
            task["phase"] = "Eliminando correos"
            email_ids = [r[0] for r in session.query(Email.id).filter(Email.account_id.in_(ids)).all()]
            for sub_start in range(0, len(email_ids), EMAIL_BATCH):
                if task and task.get("cancelled"):
                    task["status"] = "cancelled"
                    return
                sub_ids = email_ids[sub_start:sub_start + EMAIL_BATCH]
                session.query(Attachment).filter(Attachment.email_id.in_(sub_ids)).delete(synchronize_session=False)
                session.query(Email).filter(Email.id.in_(sub_ids)).delete(synchronize_session=False)
                progress += len(sub_ids)
                task["current"] = progress
            session.query(DeletedEmail).filter(DeletedEmail.account_id.in_(ids)).delete(synchronize_session=False)

        task["phase"] = "Eliminando carpetas"
        progress += 1
        task["current"] = progress
        session.query(Folder).filter(Folder.account_id.in_(ids)).delete(synchronize_session=False)

        task["phase"] = "Eliminando cuentas"
        progress += 1
        task["current"] = progress
        session.query(Account).filter(Account.id.in_(ids)).delete(synchronize_session=False)

        task["phase"] = "Guardando cambios..."
        session.commit()
        task["status"] = "done"
        task["current"] = task["total"]
        task["deleted"] = total_accts
    except Exception as e:
        session.rollback()
        task.update({"status": "error", "error": str(e)})
    finally:
        session.close()


@router.get("/batch-delete/status/{task_id}")
def batch_delete_status(task_id: str):
    task = BATCH_DELETE_TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.post("/batch-delete/{task_id}/cancel")
def cancel_batch_delete(task_id: str):
    task = BATCH_DELETE_TASKS.get(task_id)
    if not task or task.get("status") != "running":
        raise HTTPException(status_code=400, detail="Task not running")
    BATCH_DELETE_TASKS[task_id]["cancelled"] = True
    BATCH_DELETE_TASKS[task_id]["status"] = "cancelling"
    return {"ok": True}


@router.post("/{account_id}/fetch")
def fetch_account_emails(
    account_id: int,
    force: bool = False,
    session: Session = Depends(get_session),
):
    acct = session.query(Account).filter(Account.id == account_id).first()
    if not acct:
        raise HTTPException(status_code=404, detail="Account not found")

    if acct.is_imported:
        raise HTTPException(status_code=400, detail="No se puede sincronizar una cuenta importada")

    current = fetch_service.get_status(account_id)
    if current.get("status") == "running":
        if not force:
            raise HTTPException(status_code=409, detail="Fetch already running")

    thread = threading.Thread(target=fetch_service.run_fetch, args=(account_id,), daemon=True)
    thread.start()
    return {"status": "started", "message": "Background fetch started"}


@router.get("/{account_id}/fetch-status", response_model=FetchStatusModel)
def fetch_status(account_id: int):
    status = fetch_service.get_status(account_id)
    if status.get("status") == "running":
        progress = fetch_service.get_progress(account_id)
        if progress:
            status["progress"] = progress
    return status


@router.get("/fetch-statuses")
def fetch_statuses(session: Session = Depends(get_session)):
    accounts = session.query(Account).all()
    result = {}
    for acct in accounts:
        status = fetch_service.get_status(acct.id)
        if status.get("status") == "running":
            progress = fetch_service.get_progress(acct.id)
            if progress:
                status["progress"] = progress
        result[str(acct.id)] = status
    return result


@router.get("/{account_id}/fetch-progress")
def fetch_progress_sse(request: Request, account_id: int, token: str = Query(None)):
    def event_stream():
        import time
        try:
            yield f"event: progress\ndata: {json.dumps({'current': 0, 'total': 0, 'folder': 'Iniciando...', 'total_fetched': 0})}\n\n"

            last_json = ""
            keepalive_count = 0
            while True:
                time.sleep(1.0)

                status_data = fetch_service.get_status(account_id)
                s = status_data.get("status")

                if s == "running":
                    progress_data = fetch_service.get_progress(account_id)
                    if progress_data:
                        cur_json = json.dumps(progress_data)
                        if cur_json != last_json:
                            last_json = cur_json
                            yield f"event: progress\ndata: {cur_json}\n\n"
                elif s in ("done", "error", "cancelled"):
                    progress_data = fetch_service.get_progress(account_id)
                    if progress_data:
                        yield f"event: progress\ndata: {json.dumps(progress_data)}\n\n"
                    yield f"event: status\ndata: {json.dumps(status_data)}\n\n"
                    return

                keepalive_count += 1
                if keepalive_count % 30 == 0:
                    yield ": keepalive\n\n"

        except GeneratorExit:
            pass
        except Exception:
            pass

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@router.post("/{account_id}/fetch/cancel")
def cancel_fetch(account_id: int):
    status = fetch_service.get_status(account_id)
    if status.get("status") != "running":
        return {"status": "idle", "message": "No fetch running"}

    fetch_service.set_status(account_id, {
        "status": "cancelled",
        "message": "Fetch cancelled",
        "finished_at": fetch_service._utc_now(),
    })
    return {"status": "cancelled", "message": "Fetch cancelled"}


@router.post("/test-folders")
def test_folders(data: FolderTestRequest):
    from app.imap.fetcher import list_folders
    try:
        folders = list_folders(
            server=data.imap_server,
            port=data.imap_port,
            use_ssl=data.imap_use_ssl,
            username=data.username,
            password=data.password,
        )
        return {"ok": True, "folders": folders}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Connection failed: {e}")


@router.post("/{account_id}/fetch-folders")
def fetch_folders(account_id: int, session: Session = Depends(get_session)):
    acct = session.query(Account).filter(Account.id == account_id).first()
    if not acct:
        raise HTTPException(status_code=404, detail="Account not found")

    if acct.is_imported:
        raise HTTPException(status_code=400, detail="No se puede probar conexión en una cuenta importada")

    from app.imap.fetcher import list_folders
    try:
        folders = list_folders(
            server=acct.imap_server,
            port=acct.imap_port,
            use_ssl=acct.imap_use_ssl,
            username=acct.username or acct.email,
            password=decrypt(acct.password_encrypted),
            account=acct if acct.uses_oauth else None,
        )
        return {"ok": True, "folders": folders}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Connection failed: {e}")
