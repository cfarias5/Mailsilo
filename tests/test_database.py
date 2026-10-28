from __future__ import annotations

from app.database import _normalize_db_url


def test_adds_psycopg2_driver_to_plain_postgres_url():
    assert (
        _normalize_db_url("postgresql://mailsilo:secret@postgres:5432/mailsilo")
        == "postgresql+psycopg2://mailsilo:secret@postgres:5432/mailsilo"
    )


def test_supports_postgres_alias():
    assert (
        _normalize_db_url("postgres://mailsilo:secret@postgres:5432/mailsilo")
        == "postgresql+psycopg2://mailsilo:secret@postgres:5432/mailsilo"
    )


def test_respects_explicit_driver():
    url = "postgresql+psycopg://mailsilo:secret@postgres:5432/mailsilo"
    assert _normalize_db_url(url) == url


def test_leaves_sqlite_urls_untouched():
    assert _normalize_db_url("sqlite:///tmp/mailsilo.db") == "sqlite:///tmp/mailsilo.db"
