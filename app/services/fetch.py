from __future__ import annotations
import threading
from datetime import datetime, timezone

class FetchService:
    def __init__(self):
        self._status: dict[int, dict] = {}
        self._progress: dict[int, dict] = {}
        self._lock = threading.Lock()

    def _utc_now(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def get_status(self, account_id: int) -> dict:
        with self._lock:
            return self._status.get(account_id, {"status": "idle", "message": ""})

    def set_status(self, account_id: int, data: dict):
        with self._lock:
            self._status[account_id] = data

    def get_progress(self, account_id: int) -> dict:
        with self._lock:
            return self._progress.get(account_id, {})

    def set_progress(self, account_id: int, data: dict):
        with self._lock:
            self._progress[account_id] = data

    def run_fetch(self, account_id: int):
        from app.imap.fetcher import fetch_account
        from app.database import get_session
        from app.models import Account

        self.set_status(account_id, {
            "status": "running",
            "message": "Sincronizando...",
            "started_at": self._utc_now(),
        })

        session = get_session()
        try:
            acct = session.query(Account).filter(Account.id == account_id).first()
            if not acct:
                self.set_status(account_id, {"status": "error", "message": "Account not found", "finished_at": self._utc_now()})
                self.set_progress(account_id, {"status": "error", "message": "Account not found"})
                return

            n = fetch_account(acct)

            acct.last_fetch = datetime.now(timezone.utc)
            session.commit()

            self.set_status(account_id, {
                "status": "done",
                "message": f"{n} nuevos correos",
                "fetched": n,
                "finished_at": self._utc_now(),
            })
            self.set_progress(account_id, {"status": "done", "message": f"{n} nuevos correos"})

        except Exception as e:
            session.rollback()
            self.set_status(account_id, {
                "status": "error",
                "message": str(e),
                "finished_at": self._utc_now(),
            })
            self.set_progress(account_id, {"status": "error", "message": str(e)})
        finally:
            session.close()

fetch_service = FetchService()
