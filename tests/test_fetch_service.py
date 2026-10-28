from __future__ import annotations

from app.models import Account
from app.services.fetch import build_completion_status, fetch_service


def test_build_completion_status_done():
    status = build_completion_status(12, finished_at="2026-10-28T00:00:00+00:00")

    assert status["status"] == "done"
    assert status["fetched"] == 12
    assert status["folder_errors"] == []
    assert "12 nuevos correos" in status["message"]
    assert status["finished_at"] == "2026-10-28T00:00:00+00:00"


def test_build_completion_status_partial_lists_errors():
    status = build_completion_status(
        5,
        ["INBOX: [Errno 36] File name too long", "Sent: timeout"],
    )

    assert status["status"] == "partial"
    assert status["fetched"] == 5
    assert status["folder_errors"] == [
        "INBOX: [Errno 36] File name too long",
        "Sent: timeout",
    ]
    assert "INBOX" in status["message"]
    assert "2 carpeta(s) con error" in status["message"]


def test_build_completion_status_limits_verbose_error_detail():
    errors = [f"Folder{i}: boom" for i in range(8)]

    status = build_completion_status(1, errors)

    assert "(+3 más)" in status["message"]
    assert status["folder_errors"] == errors


def test_run_fetch_reports_partial_when_a_folder_fails(monkeypatch, patched_db):
    with patched_db() as session:
        session.add(
            Account(
                id=1,
                name="Test",
                email="test@example.com",
                imap_server="imap.example.com",
                folders="INBOX",
            )
        )
        session.commit()

    def fake_fetch(account, errors=None):
        errors.append("INBOX: simulate failure")
        return 7

    monkeypatch.setattr("app.imap.fetcher.fetch_account", fake_fetch)

    fetch_service.run_fetch(1)

    status = fetch_service.get_status(1)
    assert status["status"] == "partial"
    assert status["fetched"] == 7
    assert status["folder_errors"] == ["INBOX: simulate failure"]


def test_run_fetch_reports_done_without_errors(monkeypatch, patched_db):
    with patched_db() as session:
        session.add(
            Account(
                id=2,
                name="Test",
                email="test2@example.com",
                imap_server="imap.example.com",
                folders="INBOX",
            )
        )
        session.commit()

    monkeypatch.setattr(
        "app.imap.fetcher.fetch_account", lambda account, errors=None: 3
    )

    fetch_service.run_fetch(2)

    status = fetch_service.get_status(2)
    assert status["status"] == "done"
    assert status["fetched"] == 3
    assert status["folder_errors"] == []

    with patched_db() as session:
        assert session.get(Account, 2).last_fetch is not None


def test_run_fetch_keeps_cancelled_status(monkeypatch, patched_db):
    with patched_db() as session:
        session.add(
            Account(
                id=3,
                name="Test",
                email="test3@example.com",
                imap_server="imap.example.com",
                folders="INBOX",
            )
        )
        session.commit()

    def fake_fetch(account, errors=None):
        fetch_service.set_status(3, {"status": "cancelled", "message": "Fetch cancelled"})
        return 0

    monkeypatch.setattr("app.imap.fetcher.fetch_account", fake_fetch)

    fetch_service.run_fetch(3)

    assert fetch_service.get_status(3)["status"] == "cancelled"
    with patched_db() as session:
        assert session.get(Account, 3).last_fetch is None
