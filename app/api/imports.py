from __future__ import annotations

import os
import threading
import uuid
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
import anyio
import time

from app.database import get_session
from app.importers.eml import import_eml
from app.api.deps import get_current_user

CHUNK = 1024 * 1024

router = APIRouter(prefix="/api/import", tags=["import"], dependencies=[Depends(get_current_user)])

_import_tasks: dict[str, dict] = {}


def _cleanup_old_tasks():
    now = time.time()
    stale = [tid for tid, t in _import_tasks.items()
             if t.get("status") in ("done", "error") and now - t.get("_ts", 0) > 300]
    for tid in stale:
        _import_tasks.pop(tid, None)


async def _save_upload(file: UploadFile, suffix: str = "") -> Path:
    tmp = Path(f"/tmp/mailsilo_{uuid.uuid4().hex}{suffix}")
    with open(tmp, "wb") as f:
        while True:
            chunk = await file.read(CHUNK)
            if not chunk:
                break
            await anyio.to_thread.run_sync(f.write, chunk)
    return tmp


@router.post("/eml")
async def upload_eml(
    file: UploadFile = File(...),
    account_id: int = Form(0),
):
    tmp = await _save_upload(file, f"_{file.filename or 'import.eml'}")
    try:
        n = import_eml(tmp, account_id=account_id)
        return {"imported": n, "filename": file.filename}
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        tmp.unlink(missing_ok=True)


@router.post("/pst")
async def upload_pst(
    file: UploadFile = File(...),
    account_id: int = Form(0),
):
    from app.importers.pst import import_pst, _check_dependencies

    missing = _check_dependencies()
    if missing:
        raise HTTPException(400, f"Missing dependencies: {'; '.join(missing)}")

    _cleanup_old_tasks()
    task_id = uuid.uuid4().hex
    _import_tasks[task_id] = {
        "status": "uploading",
        "message": "Guardando archivo en servidor...",
        "filename": file.filename or "import.pst",
        "_ts": time.time(),
    }
    tmp = await _save_upload(file, f"_{file.filename or 'import.pst'}")

    def progress(current: int, total: int, msg: str = ""):
        _import_tasks[task_id] = {
            "status": "processing",
            "current": current,
            "total": total,
            "message": msg,
            "filename": file.filename or "import.pst",
        }

    progress(0, 0, "Preparando...")

    def run():
        try:
            n, errors = import_pst(tmp, account_id=account_id, progress_cb=progress)
            _import_tasks[task_id] = {
                "status": "done",
                "imported": n,
                "errors": errors,
                "filename": file.filename or "import.pst",
                "_ts": time.time(),
            }
        except Exception as e:
            _import_tasks[task_id] = {"status": "error", "error": str(e), "_ts": time.time()}
        finally:
            tmp.unlink(missing_ok=True)

    threading.Thread(target=run, daemon=True).start()
    return {"task_id": task_id}


@router.post("/ost")
async def upload_ost(
    file: UploadFile = File(...),
    account_id: int = Form(0),
):
    from app.importers.pst import import_ost, _check_dependencies

    missing = _check_dependencies()
    if missing:
        raise HTTPException(400, f"Missing dependencies: {'; '.join(missing)}")

    _cleanup_old_tasks()
    task_id = uuid.uuid4().hex
    _import_tasks[task_id] = {
        "status": "uploading",
        "message": "Guardando archivo en servidor...",
        "filename": file.filename or "import.ost",
        "_ts": time.time(),
    }
    tmp = await _save_upload(file, f"_{file.filename or 'import.ost'}")

    def progress(current: int, total: int, msg: str = ""):
        _import_tasks[task_id] = {
            "status": "processing",
            "current": current,
            "total": total,
            "message": msg,
            "filename": file.filename or "import.ost",
        }

    progress(0, 0, "Preparando...")

    def run():
        try:
            n, errors = import_ost(tmp, account_id=account_id, progress_cb=progress)
            _import_tasks[task_id] = {
                "status": "done",
                "imported": n,
                "errors": errors,
                "filename": file.filename or "import.ost",
                "_ts": time.time(),
            }
        except Exception as e:
            _import_tasks[task_id] = {"status": "error", "error": str(e), "_ts": time.time()}
        finally:
            tmp.unlink(missing_ok=True)

    threading.Thread(target=run, daemon=True).start()
    return {"task_id": task_id}


@router.post("/mbox")
async def upload_mbox(
    file: UploadFile = File(...),
    account_id: int = Form(0),
):
    _cleanup_old_tasks()
    task_id = uuid.uuid4().hex
    _import_tasks[task_id] = {
        "status": "uploading",
        "message": "Guardando archivo en servidor...",
        "filename": file.filename or "import.mbox",
        "_ts": time.time(),
    }
    tmp = await _save_upload(file, f"_{file.filename or 'import.mbox'}")

    def progress(current: int, total: int):
        _import_tasks[task_id] = {
            "status": "processing",
            "current": current,
            "total": total,
            "filename": file.filename or "import.mbox",
        }

    progress(0, 0)

    def run():
        try:
            from app.importers.mbox import import_mbox
            result = import_mbox(tmp, account_id=account_id, progress_cb=progress)
            _import_tasks[task_id] = {
                "status": "done",
                "imported": result["imported"],
                "errors": result["errors"],
                "filename": file.filename or "import.mbox",
                "_ts": time.time(),
            }
        except Exception as e:
            _import_tasks[task_id] = {"status": "error", "error": str(e), "_ts": time.time()}
        finally:
            tmp.unlink(missing_ok=True)

    thread = threading.Thread(target=run, daemon=True)
    thread.start()

    return {"task_id": task_id}


@router.get("/status/{task_id}")
def import_status(task_id: str):
    _cleanup_old_tasks()
    task = _import_tasks.get(task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    return task

@router.get("/active")
def active_imports():
    _cleanup_old_tasks()
    result = {}
    for tid, task in _import_tasks.items():
        if task.get("status") in ("processing", "uploading"):
            result[tid] = task
    return result
