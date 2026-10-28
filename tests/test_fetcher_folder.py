from __future__ import annotations

import email
import errno
import os
from types import SimpleNamespace

import pytest

from app.imap import fetcher
from app.models import Attachment, Email


class FakeIMAPClient:
    """Cliente IMAP mínimo para ejercitar _fetch_folder sin red."""

    def __init__(self, messages: dict[int, bytes], uidvalidity: int = 42):
        self.messages = messages
        self.uidvalidity = uidvalidity
        self.fetched_bodies: list[int] = []

    def select_folder(self, name, readonly=True):
        assert readonly is True
        return {b"UIDVALIDITY": self.uidvalidity}

    def search(self, criteria):
        return sorted(self.messages)

    def fetch(self, uids, items):
        if "BODY.PEEK[]" in items:
            self.fetched_bodies.extend(uids)
            return {uid: {b"BODY[]": self.messages[uid]} for uid in uids}

        result = {}
        for uid in uids:
            raw = self.messages[uid]
            header = raw.split(b"\r\n\r\n", 1)[0] + b"\r\n\r\n"
            result[uid] = {b"BODY[HEADER]": header, b"RFC822.SIZE": len(raw)}
        return result


def make_message(
    uid: int,
    subject: str = "Hello",
    filename: str | None = None,
    payload: bytes = b"some bytes",
    date: str = "Wed, 28 Oct 2026 09:40:09 +0000",
) -> bytes:
    msg = email.message.EmailMessage()
    msg["Subject"] = subject
    msg["From"] = "Sender Name <sender@example.com>"
    msg["To"] = "me@example.com"
    msg["Date"] = date
    msg["Message-ID"] = f"<uid{uid}@example.com>"
    msg.set_content("plain body")
    if filename is not None:
        msg.add_attachment(
            payload,
            maintype="application",
            subtype="octet-stream",
            filename=filename,
        )
    return msg.as_bytes()


@pytest.fixture()
def account():
    return SimpleNamespace(id=1, email="test@example.com")


@pytest.fixture()
def storage(monkeypatch, tmp_path):
    path = tmp_path / "attachments"
    monkeypatch.setattr(fetcher, "ATTACHMENT_STORAGE", str(path))
    return path


def test_pathological_attachment_names_do_not_abort_folder(
    patched_db, account, storage
):
    client = FakeIMAPClient(
        {
            1: make_message(1, filename="report.pdf"),
            2: make_message(2, filename="a" * 400 + ".pdf"),
            3: make_message(3, filename="../../etc/passwd"),
            4: make_message(4, filename="facturas/2024/enero.pdf"),
        }
    )

    count = fetcher._fetch_folder(client, account, "INBOX")

    assert count == 4
    with patched_db() as session:
        assert session.query(Email).count() == 4
        attachments = session.query(Attachment).all()
        assert len(attachments) == 4
        for att in attachments:
            assert att.file_path is not None
            assert os.path.isfile(att.file_path)
            # El archivo nunca sale del directorio de almacenamiento.
            assert os.path.commonpath([att.file_path, str(storage)]) == str(storage)
            assert att.data is None
            assert len(os.path.basename(att.file_path).encode("utf-8")) < 255


def test_one_broken_attachment_does_not_lose_the_email(
    monkeypatch, patched_db, account, storage
):
    original_save = fetcher._save_attachment

    def flaky_save(email_id, filename, payload):
        if "boom" in filename:
            raise OSError(errno.ENAMETOOLONG, "File name too long")
        return original_save(email_id, filename, payload)

    monkeypatch.setattr(fetcher, "_save_attachment", flaky_save)

    client = FakeIMAPClient(
        {
            1: make_message(1, filename="ok.txt"),
            2: make_message(2, filename="boom.txt"),
            3: make_message(3, filename="ok2.txt"),
        }
    )

    assert fetcher._fetch_folder(client, account, "INBOX") == 3

    with patched_db() as session:
        assert session.query(Email).count() == 3
        broken = (
            session.query(Attachment)
            .filter(Attachment.filename == "boom.txt")
            .one()
        )
        # El blob queda como respaldo en PostgreSQL para que la descarga siga
        # funcionando aunque el archivo no se pudiera escribir.
        assert broken.file_path is None
        assert broken.data == b"some bytes"


def test_fatal_storage_error_stops_folder_but_keeps_previous_emails(
    monkeypatch, patched_db, account, storage
):
    original_save = fetcher._save_attachment

    def flaky_save(email_id, filename, payload):
        if "full" in filename:
            raise OSError(errno.ENOSPC, "No space left on device")
        return original_save(email_id, filename, payload)

    monkeypatch.setattr(fetcher, "_save_attachment", flaky_save)

    client = FakeIMAPClient(
        {
            1: make_message(1, filename="ok.txt"),
            2: make_message(2, filename="full.bin"),
            3: make_message(3, filename="never-processed.txt"),
        }
    )

    with pytest.raises(fetcher.FatalStorageError):
        fetcher._fetch_folder(client, account, "INBOX")

    with patched_db() as session:
        # El correo anterior al fallo se conserva; el problemático no.
        assert session.query(Email).count() == 1
        assert session.query(Email).one().uid == 1


def test_one_unparseable_message_does_not_abort_batch(
    monkeypatch, patched_db, account, storage
):
    original_get_body = fetcher._get_body

    def flaky_get_body(msg):
        if "boom" in str(msg.get("Subject", "")):
            raise ValueError("malformed body")
        return original_get_body(msg)

    monkeypatch.setattr(fetcher, "_get_body", flaky_get_body)

    client = FakeIMAPClient(
        {
            1: make_message(1, subject="good one"),
            2: make_message(2, subject="boom"),
            3: make_message(3, subject="good two"),
        }
    )

    assert fetcher._fetch_folder(client, account, "INBOX") == 2

    with patched_db() as session:
        subjects = {e.subject for e in session.query(Email).all()}
        assert subjects == {"good one", "good two"}


def test_long_subject_is_truncated_to_column_size(patched_db, account, storage):
    client = FakeIMAPClient({1: make_message(1, subject="x" * 2000)})

    assert fetcher._fetch_folder(client, account, "INBOX") == 1

    with patched_db() as session:
        stored = session.query(Email).one()
        assert len(stored.subject) == 512


def test_incremental_fetch_only_downloads_new_uids(patched_db, account, storage):
    with patched_db() as session:
        session.add(
            Email(
                account_id=1,
                folder="INBOX",
                uid=10,
                uidvalidity=42,
                message_id="<old@example.com>",
            )
        )
        session.commit()

    client = FakeIMAPClient(
        {
            5: make_message(5),
            10: make_message(10),
            11: make_message(11),
            12: make_message(12),
        }
    )

    assert fetcher._fetch_folder(client, account, "INBOX") == 2
    assert client.fetched_bodies == [11, 12]

    with patched_db() as session:
        assert {e.uid for e in session.query(Email).all()} == {10, 11, 12}


def test_duplicate_message_id_is_not_stored_twice(patched_db, account, storage):
    with patched_db() as session:
        session.add(
            Email(
                account_id=1,
                folder="INBOX",
                uid=1,
                uidvalidity=None,
                message_id="<uid1@example.com>",
            )
        )
        session.commit()

    # uidvalidity distinta fuerza un full fetch, así que el mensaje 1 se vuelve
    # a ver por cabecera y debe detectarse como duplicado.
    client = FakeIMAPClient({1: make_message(1), 2: make_message(2)}, uidvalidity=99)

    assert fetcher._fetch_folder(client, account, "INBOX") == 1

    with patched_db() as session:
        assert session.query(Email).count() == 2
        assert session.query(Email).filter(Email.uid == 2).count() == 1
