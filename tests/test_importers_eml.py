from __future__ import annotations

import email
from email.header import Header

from app.importers import eml


def _multipart_msg(*parts: tuple[str, str], boundary: str = "BOUNDARY") -> email.message.Message:
    raw = (
        "From: sender@example.com\r\n"
        "Subject: Test subject\r\n"
        "Date: Wed, 28 Oct 2026 09:40:09 +0000\r\n"
        "Message-ID: <msg1@example.com>\r\n"
        "MIME-Version: 1.0\r\n"
        f"Content-Type: multipart/mixed; boundary=\"{boundary}\"\r\n\r\n"
    )
    for headers, body in parts:
        raw += f"--{boundary}\r\n{headers}\r\n\r\n{body}\r\n"
    raw += f"--{boundary}--\r\n"
    return email.message_from_bytes(raw.encode("utf-8"))


def test_get_attachments_decodes_encoded_filename():
    msg = _multipart_msg(
        (
            (
                "Content-Type: text/plain\r\n"
                "Content-Transfer-Encoding: 7bit\r\n\r\n"
                "hello"
            ),
            "hello",
        ),
        (
            (
                "Content-Type: application/pdf\r\n"
                "Content-Disposition: attachment; filename=\"=?utf-8?q?r=C3=A9sum=C3=A9=2Epdf?=\"\r\n"
                "Content-Transfer-Encoding: base64\r\n\r\n"
                "aGVsbG8="
            ),
            "hello",
        ),
    )

    attachments, errors = eml._get_attachments(msg)

    assert errors == []
    assert len(attachments) == 1
    filename, ctype, _cid, payload = attachments[0]
    assert filename == "résumé.pdf"
    assert ctype == "application/pdf"
    assert payload == b"hello"


def test_get_attachments_handles_header_objects_in_place_of_strings():
    """Cabeceras que vienen como ``email.header.Header`` no soportan ``.lower()``.

    Regresión: el import de un PST/OST con adjuntos con nombre codificado
    fallaba con ``'Header' object has no attribute 'lower'``.
    """

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
            value = default
            lname = (name or "").lower()
            if lname in ("content-disposition", "content-id"):
                value = self.disposition_value
            if value is None:
                return None
            if lname in ("content-disposition", "content-id"):
                return Header(str(value))
            return value

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

    part = StubPart(
        "image/jpeg",
        'attachment; filename="=?utf-8?q?photo=2C_+C3=A9=C3=A9.jpg?="',
    )

    attachments, errors = eml._get_attachments(part)

    assert errors == []
    assert len(attachments) == 1
    filename, ctype, _cid, payload = attachments[0]
    assert ctype == "image/jpeg"
    assert payload == b"payload"
    assert filename
    assert "jpg" in filename


def test_get_attachments_creates_inline_image_from_content_id():
    msg = _multipart_msg(
        (
            (
                "Content-Type: image/jpeg\r\n"
                "Content-ID: <inline-1@e>\r\n"
                "Content-Disposition: inline\r\n"
                "Content-Transfer-Encoding: base64\r\n\r\n"
                "aGVsbG8="
            ),
            "x",
        )
    )

    attachments, errors = eml._get_attachments(msg)

    assert errors == []
    assert len(attachments) == 1
    filename, ctype, _cid, _payload = attachments[0]
    assert filename == "inline-1@e"
    assert ctype == "image/jpeg"


def test_get_attachments_skips_plain_text_messages():
    msg = email.message.EmailMessage()
    msg["Subject"] = "hello"
    msg.set_content("body only")

    attachments, errors = eml._get_attachments(msg)

    assert attachments == []
    assert errors == []


def test_get_attachments_returns_error_for_unreadable_part():
    class BrokenPart:
        def is_multipart(self) -> bool:
            return True

        def get_content_maintype(self) -> str:
            return "application"

        def get_content_type(self) -> str:
            return "application/pdf"

        def get(self, name, default=None):
            if (name or "").lower() == "content-disposition":
                return "attachment; filename=\"broken.pdf\""
            return default

        def get_filename(self):
            return "broken.pdf"

        def get_payload(self, decode=True):
            raise ValueError("boom")

        def walk(self):
            yield self
            return iter(())

    attachments, errors = eml._get_attachments(BrokenPart())

    assert attachments == []
    assert any("boom" in str(e) for e in errors)


def test_clean_filename_truncates_long_names():
    assert len(eml._clean_filename("a" * 600 + ".pdf")) <= 512
    assert eml._clean_filename("a" * 600 + ".pdf")
    assert eml._clean_filename(None) == "adjunto"
    assert eml._clean_filename("bad\x00name.pdf") == "badname.pdf"


def test_str_header_accepts_header_objects_and_bytes():
    assert eml._str_header(None) == ""
    assert eml._str_header("plain") == "plain"
    assert eml._str_header(b"bytes") == "bytes"
    assert isinstance(eml._str_header(Header("=?utf-8?q?a=2Ab?= ")), str)


def test_clean_str_applies_max_length():
    assert eml._clean_str("x" * 2000, 512) == "x" * 512
    assert eml._clean_str("abc") == "abc"


def test_parse_date_is_tolerant_to_garbage():
    assert eml._parse_date("") is None
    assert eml._parse_date("not a date at all") is None
    assert eml._parse_date(Header("Wed, 28 Oct 2026 09:40:09 +0000")) is not None


def _eml_bytes(subject: str = "Hello", attachment_filename: str | None = None) -> bytes:
    headers = (
        "From: sender@example.com\r\n"
        f"Subject: {subject}\r\n"
        "Date: Wed, 28 Oct 2026 09:40:09 +0000\r\n"
        "Message-ID: <msg1@example.com>\r\n"
        "MIME-Version: 1.0\r\n"
        "Content-Type: multipart/mixed; boundary=\"BOUNDARY\"\r\n\r\n"
        "--BOUNDARY\r\nContent-Type: text/plain\r\n\r\nhello\r\n"
    )
    if attachment_filename:
        headers += (
            "--BOUNDARY\r\nContent-Type: application/pdf\r\n"
            f"Content-Disposition: attachment; filename=\"{attachment_filename}\"\r\n"
            "Content-Transfer-Encoding: base64\r\n\r\naGVsbG8=\r\n"
        )
    headers += "--BOUNDARY--\r\n"
    return headers.encode("utf-8")


def test_import_eml_with_encoded_attachment_name(tmp_path, monkeypatch, session_factory):
    p = tmp_path / "1187.eml"
    p.write_bytes(_eml_bytes(attachment_filename="=?utf-8?q?r=C3=A9sum=C3=A9=2Epdf?="))

    monkeypatch.setattr("app.importers.eml.get_session", lambda: session_factory())

    errors: list[str] = []
    n = eml.import_eml(p, account_id=0, errors=errors)

    assert n == 1
    assert errors == []


def test_import_eml_clamps_long_subject_and_filenames(tmp_path, monkeypatch, session_factory):
    p = tmp_path / "big.eml"
    p.write_bytes(_eml_bytes(subject="x" * 2000, attachment_filename="a" * 600 + ".pdf"))

    monkeypatch.setattr("app.importers.eml.get_session", lambda: session_factory())

    errors = []
    n = eml.import_eml(p, account_id=0, errors=errors)

    assert n == 1
    assert errors == []

    with session_factory() as session:
        email = session.query(eml.Email).order_by(eml.Email.id.desc()).first()
        assert len(email.subject) == 512
        assert len(session.query(eml.Attachment).filter(eml.Attachment.email_id == email.id).first().filename) <= 512
