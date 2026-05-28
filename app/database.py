from __future__ import annotations

from pathlib import Path
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker


class Base(DeclarativeBase):
    pass


_engine = None
_SessionLocal = None


def get_db_path() -> str:
    from .config import get_config
    return get_config().db_path


def init_db(db_path: str | None = None) -> None:
    global _engine, _SessionLocal

    if db_path is None:
        db_path = get_db_path()

    _engine = create_engine(
        db_path, echo=False,
        pool_size=20, max_overflow=30, pool_pre_ping=True,
    )

    _SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False)
    Base.metadata.create_all(_engine)

    _migrate_schema()


def _migrate_schema():
    conn = _engine.connect()

    # Add FTS search_vector column to emails using trigger
    cols = [row[0] for row in conn.execute(text(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'emails'"
    ))]
    if "search_vector" not in cols:
        conn.execute(text(
            "ALTER TABLE emails ADD COLUMN search_vector tsvector"
        ))

    # Create trigger function and trigger to auto-update search_vector
    conn.execute(text(
        "CREATE OR REPLACE FUNCTION update_email_search_vector() RETURNS trigger AS $$"
        "BEGIN"
        "  NEW.search_vector := to_tsvector('spanish',"
        "    coalesce(NEW.subject, '') || ' ' ||"
        "    coalesce(NEW.sender_name, '') || ' ' ||"
        "    coalesce(NEW.sender_email, '') || ' ' ||"
        "    coalesce(NEW.body_text, ''));"
        "  RETURN NEW;"
        "END;"
        "$$ LANGUAGE plpgsql"
    ))
    conn.execute(text(
        "DROP TRIGGER IF EXISTS trg_email_search_vector ON emails"
    ))
    conn.execute(text(
        "CREATE TRIGGER trg_email_search_vector"
        "  BEFORE INSERT OR UPDATE ON emails"
        "  FOR EACH ROW EXECUTE FUNCTION update_email_search_vector()"
    ))

    # GIN index for fast FTS queries
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS idx_emails_search_vector ON emails USING GIN(search_vector)"
    ))

    # Sync intervals
    cols_account = [row[0] for row in conn.execute(text(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'accounts'"
    ))]
    if "sync_interval" not in cols_account:
        conn.execute(text("ALTER TABLE accounts ADD COLUMN sync_interval VARCHAR(10)"))

    if "file_path" not in cols_account:  # actually belongs to attachments
        pass

    cols_att = [row[0] for row in conn.execute(text(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'attachments'"
    ))]
    if "file_path" not in cols_att:
        conn.execute(text("ALTER TABLE attachments ADD COLUMN file_path VARCHAR(1024)"))

    cols_sess = [row[0] for row in conn.execute(text(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'session_tokens'"
    ))]
    if "expires_at" not in cols_sess:
        conn.execute(text("ALTER TABLE session_tokens ADD COLUMN expires_at TIMESTAMP"))

    cols_acct = [row[0] for row in conn.execute(text(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'accounts'"
    ))]
    if "oauth_provider" not in cols_acct:
        conn.execute(text("ALTER TABLE accounts ADD COLUMN oauth_provider VARCHAR(50)"))
        conn.execute(text("ALTER TABLE accounts ADD COLUMN oauth_refresh_token TEXT"))
        conn.execute(text("ALTER TABLE accounts ADD COLUMN oauth_token_expiry TIMESTAMP"))

    if "smtp_server" not in cols_acct:
        conn.execute(text("ALTER TABLE accounts ADD COLUMN smtp_server VARCHAR(255)"))
        conn.execute(text("ALTER TABLE accounts ADD COLUMN smtp_port INTEGER"))
        conn.execute(text("ALTER TABLE accounts ADD COLUMN smtp_use_ssl BOOLEAN"))
        conn.execute(text("ALTER TABLE accounts ADD COLUMN smtp_username VARCHAR(255)"))
        conn.execute(text("ALTER TABLE accounts ADD COLUMN smtp_password_encrypted TEXT"))

    if "is_imported" not in cols_acct:
        conn.execute(text("ALTER TABLE accounts ADD COLUMN is_imported BOOLEAN NOT NULL DEFAULT FALSE"))
        conn.execute(text(
            "UPDATE accounts SET is_imported = TRUE "
            "WHERE enabled = FALSE AND (password_encrypted IS NULL OR password_encrypted = '')"
        ))

    # Encrypt existing plaintext passwords (one-time migration)
    try:
        from app.crypto import encrypt, decrypt
        sample = conn.execute(text("SELECT password_encrypted FROM accounts WHERE password_encrypted != '' LIMIT 1")).scalar()
        if sample and decrypt(sample) == sample:
            for row in conn.execute(text("SELECT id, password_encrypted, smtp_password_encrypted FROM accounts")).all():
                if row[1]:
                    conn.execute(text("UPDATE accounts SET password_encrypted = :enc WHERE id = :id"), {"enc": encrypt(row[1]), "id": row[0]})
                if row[2]:
                    conn.execute(text("UPDATE accounts SET smtp_password_encrypted = :enc WHERE id = :id"), {"enc": encrypt(row[2]), "id": row[0]})
            srow = conn.execute(text("SELECT value FROM settings WHERE key = 'smtp'")).scalar()
            if srow:
                import json
                cfg = json.loads(srow)
                if cfg.get("password"):
                    cfg["password"] = encrypt(cfg["password"])
                    conn.execute(text("UPDATE settings SET value = :val WHERE key = 'smtp'"), {"val": json.dumps(cfg)})
    except Exception:
        pass

    # Create settings table if not exists
    conn.execute(text(
        "CREATE TABLE IF NOT EXISTS settings ("
        "  key VARCHAR(255) PRIMARY KEY,"
        "  value TEXT NOT NULL DEFAULT ''"
        ")"
    ))

    # Performance indexes
    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_emails_folder ON emails(folder)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_emails_account_folder ON emails(account_id, folder)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_emails_folder_date ON emails(folder, date)"))

    # Populate search_vector for existing rows
    conn.execute(text("UPDATE emails SET search_vector = to_tsvector('spanish', coalesce(subject, '') || ' ' || coalesce(sender_name, '') || ' ' || coalesce(sender_email, '') || ' ' || coalesce(body_text, '')) WHERE search_vector IS NULL"))

    conn.commit()
    conn.close()


def get_session():
    if _SessionLocal is None:
        init_db()
    return _SessionLocal()
