from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_session
from app.models import Email, Account
from app.api.deps import get_current_user

router = APIRouter(prefix="/api/folders", tags=["folders"], dependencies=[Depends(get_current_user)])


@router.get("")
def list_folders(session: Session = Depends(get_session)):
    rows = (
        session.query(
            Email.folder,
            Email.account_id,
            func.count(Email.id).label("count"),
        )
        .group_by(Email.folder, Email.account_id)
        .order_by(Email.folder)
        .all()
    )

    accounts = {a.id: {"email": a.email, "name": a.name, "folders": a.folders} for a in session.query(Account).all()}

    # Build folder list per account from emails in DB
    folders_by_account: dict[int, dict] = {}
    for r in rows:
        acct_id = r.account_id or 0
        if acct_id not in folders_by_account:
            info = accounts.get(acct_id, {"email": "Importado", "name": "Importado"})
            folders_by_account[acct_id] = {
                "account_id": acct_id,
                "account_email": info["email"],
                "account_name": info["name"],
                "folders": [],
            }
        folders_by_account[acct_id]["folders"].append(
            {"name": r.folder, "count": r.count}
        )

    # Include accounts without emails so they appear in the sidebar
    for acct_id, info in accounts.items():
        if acct_id not in folders_by_account:
            folders_by_account[acct_id] = {
                "account_id": acct_id,
                "account_email": info["email"],
                "account_name": info["name"],
                "folders": [],
            }

    # Add discovered-but-unsynced folders from Account.folders
    for acct_id, info in accounts.items():
        synced_names = {f["name"] for f in folders_by_account.get(acct_id, {}).get("folders", [])}
        all_account_folders = [f.strip() for f in (info.get("folders") or "INBOX").split(",") if f.strip()]
        for name in all_account_folders:
            if name not in synced_names:
                folders_by_account[acct_id]["folders"].append(
                    {"name": name, "count": 0}
                )

    result = list(folders_by_account.values())
    result.sort(key=lambda x: x["account_email"])
    return result
