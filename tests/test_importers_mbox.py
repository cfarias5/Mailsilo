from __future__ import annotations

import email
from email.header import Header
from pathlib import Path

from app.importers import mbox


def test_mbox_get_attachments_handles_header_objects_in_place_of_strings():
    class StubPart:
        def __init__(self, content_type: str, disposition, payload: bytes = b"payload"):
            self.content_type_value = content_type
            self.disposition_value = disposition
            self.payload = payload

        def is_multipart(self) -> bool:
            return True

        def get_content_maintype(self) -> str:
            return self.content_type_value.split("/")[0]

        def get_content_type(self) -> str:
            return self.content_type_value

        def get(self, name, default=None):
            lname = (name or "").lower()
            if lname in ("content-disposition", "content-id"):
                value = self.disposition_value
                if value is None:
                    return None
                return Header(str(value))
            return default

        def get_filename(self):
            value = self.disposition_value
            if isinstance(value, str) and "filename=" in value:
                return value.split("filename=")[1].split(";")[0].strip().strip('"')
            return None

        def get_payload(self, decode=True):
            return self.payload

        def walk(self):
            yield self
            return iter(())

    attachments, errors = mbox._get_attachments(
        StubPart("application/pdf", "attachment; filename=\"doc.pdf\"")
    )

    assert errors == []
    assert len(attachments) == 1
    filename, ctype, _cid, _payload = attachments[0]
    assert filename == "doc.pdf"
    assert ctype == "application/pdf"


def _write_mbox(path: Path, messages: list[bytes]) -> Path:
    import mailbox

    m = mailbox.mbox(str(path))
    for msg_bytes in messages:
        m.add(email.message_from_bytes(msg_bytes))
    m.flush()
    m.close()
    return path


def _eml_bytes(subject: str = "Hello", attachment_headers: str = "") -> bytes:
    raw = (
        "From: sender@example.com\r\n"
        f"Subject: {subject}\r\n"
        "Date: Wed, 28 Oct 2026 09:40:09 +0000\r\n"
        "Message-ID: <m1@example.com>\r\n"
        "MIME-Version: 1.0\r\n"
        "Content-Type: text/plain\r\n"
        f"{attachment_headers}"
        "\r\n"
        "body text\r\n"
    )
    return raw.encode("utf-8")


def test_import_mbox_with_encoded_attachment_name_reports_no_errors(tmp_path, monkeypatch, session_factory):
    path = _write_mbox(
        tmp_path / "test.mbox",
        [
            email.message_from_bytes(
                _eml_bytes(
                    attachment_headers=(
                        'Content-Disposition: attachment; filename="=?utf-8?q?r=C3=A9sum=C3=A9=2Epdf?="\r\n'
                        "Content-Type: application/pdf\r\n"
                        "Content-Transfer-Encoding: base64\r\n"
                    )
                )
            ).as_bytes()
        ],
    )

    monkeypatch.setattr("app.importers.mbox.get_session", lambda: session_factory())

    result = mbox.import_mbox(path, account_id=0)

    assert result["imported"] == 1
    assert result["errors"] == []


def test_import_mbox_isolates_broken_messages(tmp_path, monkeypatch, session_factory):
    path = _write_mbox(
        tmp_path / "test.mbox",
        [_eml_bytes(subject="good one"), _eml_bytes(subject="bad one")],
    )

    monkeypatch.setattr("app.importers.mbox.get_session", lambda: session_factory())

    original_get_body = mbox._get_body_eml

    def flaky_get_body(msg):
        if str(msg.get("Subject") or "") == "bad one":
            raise ValueError("malformed body")
        return original_get_body(msg)

    monkeypatch.setattr(mbox, "_get_body_eml", flaky_get_body)

    result = mbox.import_mbox(path, account_id=0)

    assert result["imported"] == 1
    assert len(result["errors"]) == 1
    assert "msg" in result["errors"][0]
