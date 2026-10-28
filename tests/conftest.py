from __future__ import annotations

import os

import pytest
from sqlalchemy import create_engine
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker

import app.models  # noqa: F401  (registra todos los modelos en Base.metadata)
from app.database import Base

# Si se define TEST_DATABASE_URL los tests corren contra PostgreSQL real
# (recomendado antes de publicar). Si no, usan un SQLite temporal.
TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")


# PostgreSQL es la base de producción, pero para los tests en SQLite hay que
# enseñarle a renderizar el tipo TSVECTOR.
@compiles(TSVECTOR, "sqlite")
def _compile_tsvector_sqlite(type_, compiler, **kw):  # pragma: no cover - trivial
    return "TEXT"


@pytest.fixture()
def session_factory(tmp_path):
    if TEST_DATABASE_URL:
        engine = create_engine(TEST_DATABASE_URL, pool_pre_ping=True)
        Base.metadata.drop_all(engine)
        Base.metadata.create_all(engine)
    else:
        engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
        Base.metadata.create_all(engine)

    factory = sessionmaker(bind=engine, expire_on_commit=False)
    yield factory
    engine.dispose()


@pytest.fixture()
def patched_db(monkeypatch, session_factory):
    """Redirige las sesiones del fetcher y del servicio de sync a SQLite."""
    monkeypatch.setattr("app.imap.fetcher.get_session", lambda: session_factory())
    monkeypatch.setattr("app.database.get_session", lambda: session_factory())
    return session_factory


@pytest.fixture(autouse=True)
def reset_fetch_service():
    from app.services.fetch import fetch_service

    with fetch_service._lock:
        fetch_service._status.clear()
        fetch_service._progress.clear()
    yield
