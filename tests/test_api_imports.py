from __future__ import annotations

import time

import pytest
from fastapi import HTTPException

from app.api import imports


def test_import_status_returns_all_errors(monkeypatch):
    errors = ["1187.eml: adjunto descartado: boom" for _ in range(37)]
    monkeypatch.setitem(
        imports._import_tasks,
        "task-errors",
        {
            "status": "done",
            "imported": 10,
            "errors": errors,
            "filename": "1187.eml",
            "_ts": time.time(),
        },
    )

    task = imports.import_status("task-errors")

    assert task["status"] == "done"
    # Todos los errores se devuelven al cliente: no hay truncamiento.
    assert task["errors"] == errors
    assert len(task["errors"]) == 37


def test_import_status_task_not_found():
    with pytest.raises(HTTPException) as exc:
        imports.import_status("does-not-exist")

    assert exc.value.status_code == 404


def test_cleanup_old_tasks_keeps_processing_tasks(monkeypatch):
    monkeypatch.setitem(
        imports._import_tasks,
        "task-processing",
        {"status": "processing", "errors": [], "_ts": time.time()},
    )
    monkeypatch.setitem(
        imports._import_tasks,
        "task-done-old",
        {"status": "done", "errors": [], "_ts": time.time() - 400},
    )

    imports._cleanup_old_tasks()

    assert "task-processing" in imports._import_tasks
    assert "task-done-old" not in imports._import_tasks
