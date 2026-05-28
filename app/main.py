from __future__ import annotations

import logging
import time
import threading
from datetime import datetime, timezone, timedelta
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from .config import load_config
from .database import init_db, get_session
from .api import emails, accounts, imports, folders, auth, oauth_microsoft, settings
from .api.deps import get_current_user
from .models import Account

logger = logging.getLogger(__name__)

_STATIC = Path(__file__).parent / "static"
_TEMPLATES = Path(__file__).parent / "templates"

_scheduler_stop = threading.Event()


def _parse_interval(interval: str) -> timedelta | None:
    if not interval:
        return None
    unit = interval[-1]
    try:
        value = int(interval[:-1])
    except ValueError:
        return None
    if unit == "h":
        return timedelta(hours=value)
    elif unit == "d":
        return timedelta(days=value)
    return None


def _scheduler_loop():
    logger.info("Sync scheduler started")
    while not _scheduler_stop.is_set():
        try:
            ids = []
            session = get_session()
            try:
                now = datetime.now(timezone.utc)
                for acct in session.query(Account.id, Account.sync_interval, Account.last_fetch).filter(
                    Account.enabled == True,
                    Account.sync_interval.isnot(None),
                    Account.sync_interval != "",
                ).all():
                    delta = _parse_interval(acct.sync_interval)
                    if not delta:
                        continue
                    if acct.last_fetch and (now - acct.last_fetch.replace(tzinfo=timezone.utc)) < delta:
                        continue
                    ids.append(acct.id)
            finally:
                session.close()

            for aid in ids:
                if _scheduler_stop.is_set():
                    break
                logger.info("Scheduled sync for account %s", aid)
                from .services.fetch import fetch_service
                fetch_service.run_fetch(aid)
                s2 = get_session()
                try:
                    acct2 = s2.query(Account).filter(Account.id == aid).first()
                    if acct2:
                        acct2.last_fetch = datetime.now(timezone.utc)
                        s2.commit()
                finally:
                    s2.close()
        except Exception as e:
            logger.error("Scheduler error: %s", e)
        _scheduler_stop.wait(60)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    logging.getLogger("imapclient").setLevel(logging.WARNING)
    load_config()
    init_db()
    _STATIC.mkdir(parents=True, exist_ok=True)
    _TEMPLATES.mkdir(parents=True, exist_ok=True)

    from app.auth import cleanup_expired_sessions
    cleanup_expired_sessions()

    _scheduler_stop.clear()
    t = threading.Thread(target=_scheduler_loop, daemon=True)
    t.start()
    logger.info("MailSilo started")
    yield
    _scheduler_stop.set()
    logger.info("MailSilo stopped")


app = FastAPI(title="MailSilo", version="0.1.1", lifespan=lifespan)

# Public routers (no auth required)
app.include_router(auth.router)

# Protected routers (auth via Depends in each router definition)
app.include_router(emails.router)
app.include_router(accounts.router)
app.include_router(imports.router)
app.include_router(folders.router)
app.include_router(oauth_microsoft.router)
app.include_router(settings.router)

if _STATIC.exists():
    app.mount("/static", StaticFiles(directory=str(_STATIC)), name="static")


@app.get("/")
def serve_index():
    idx = _TEMPLATES / "index.html"
    if idx.exists():
        return FileResponse(str(idx))
    return {"message": "MailSilo API – visit /docs for Swagger UI"}


@app.post("/api/fetch-all")
def fetch_all(user: dict = Depends(get_current_user)):
    if not user or not user.get("is_admin"):
        from fastapi import HTTPException
        raise HTTPException(403, "Solo admin")
    from .imap.fetcher import fetch_all_accounts
    results = fetch_all_accounts()
    return results


@app.get("/api/stats")
def stats(user: dict = Depends(get_current_user)):
    from .database import get_session
    session = get_session()
    try:
        from .models import Email, Account, Attachment
        from sqlalchemy import func
        total_emails = session.query(Email).count()
        total_accounts = session.query(Account).count()
        email_bytes = session.query(func.sum(func.length(Email.raw))).scalar() or 0
        att_bytes = session.query(func.sum(func.length(Attachment.data))).scalar() or 0
        return {
            "total_emails": total_emails,
            "total_accounts": total_accounts,
            "total_size": email_bytes + att_bytes,
        }
    finally:
        session.close()
