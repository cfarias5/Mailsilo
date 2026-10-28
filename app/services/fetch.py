from __future__ import annotations
import threading
from datetime import datetime, timezone


def build_completion_status(
    fetched: int,
    folder_errors: list[str] | None = None,
    finished_at: str | None = None,
) -> dict:
    """Construye el estado final de una sincronización.

    ``partial`` indica que algunas carpetas fallaron pero el resto se guardó;
    la UI lo muestra como advertencia en lugar de decir que todo fue bien.
    """
    folder_errors = folder_errors or []
    finished_at = finished_at or datetime.now(timezone.utc).isoformat()
    if folder_errors:
        shown = "; ".join(folder_errors[:5])
        if len(folder_errors) > 5:
            shown += f" (+{len(folder_errors) - 5} más)"
        return {
            "status": "partial",
            "message": (
                f"{fetched} nuevos correos, {len(folder_errors)} carpeta(s) con error: {shown}"
            ),
            "fetched": fetched,
            "folder_errors": folder_errors,
            "finished_at": finished_at,
        }
    return {
        "status": "done",
        "message": f"{fetched} nuevos correos",
        "fetched": fetched,
        "folder_errors": [],
        "finished_at": finished_at,
    }


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

            folder_errors: list[str] = []
            n = fetch_account(acct, errors=folder_errors)

            if self.get_status(account_id).get("status") == "cancelled":
                self.set_progress(account_id, {
                    "status": "cancelled",
                    "message": "Sincronización cancelada",
                })
                return

            acct.last_fetch = datetime.now(timezone.utc)
            session.commit()

            status = build_completion_status(n, folder_errors)
            self.set_status(account_id, status)
            self.set_progress(account_id, {
                "status": status["status"],
                "message": status["message"],
                "folder_errors": folder_errors,
            })

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
