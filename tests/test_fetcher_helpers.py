from __future__ import annotations

import errno
import os

import pytest

from app.imap import fetcher


def test_safe_filename_keeps_normal_names():
    assert fetcher._safe_filename("report.pdf") == "report.pdf"
    assert fetcher._safe_filename("Factura 2024-01 (1).pdf") == "Factura 2024-01 (1).pdf"


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("../../etc/passwd", "passwd"),
        ("folder\\file.txt", "file.txt"),
        ("a/b/c.pdf", "c.pdf"),
        ("/absolute/path/report.docx", "report.docx"),
    ],
)
def test_safe_filename_removes_path_components(raw, expected):
    result = fetcher._safe_filename(raw)
    assert result == expected
    assert "/" not in result and "\\" not in result


def test_safe_filename_removes_nul_and_control_characters():
    result = fetcher._safe_filename("bad\x00name\nwith\x1fcontrol.txt")
    assert "\x00" not in result
    assert "\n" not in result
    assert "\x1f" not in result
    assert result.endswith(".txt")


def test_safe_filename_truncates_long_ascii_names():
    result = fetcher._safe_filename("a" * 500 + ".pdf")
    assert result.endswith(".pdf")
    assert len(result.encode("utf-8")) <= fetcher.MAX_FILENAME_BYTES


def test_safe_filename_truncates_long_unicode_names_by_bytes():
    result = fetcher._safe_filename("á" * 400 + ".txt")
    assert result.endswith(".txt")
    assert len(result.encode("utf-8")) <= fetcher.MAX_FILENAME_BYTES
    # No debe quedar ningún carácter que no se pueda codificar en UTF-8.
    result.encode("utf-8")


@pytest.mark.parametrize("raw", ["", "   ", "..", "...", None])
def test_safe_filename_fallbacks(raw):
    assert fetcher._safe_filename(raw) == "adjunto"


def test_save_attachment_sanitizes_and_writes_inside_email_dir(monkeypatch, tmp_path):
    monkeypatch.setattr(fetcher, "ATTACHMENT_STORAGE", str(tmp_path))

    path = fetcher._save_attachment(7, "a" * 400 + ".pdf", b"payload")

    assert os.path.isfile(path)
    assert os.path.dirname(path) == str(tmp_path / "7")
    basename = os.path.basename(path)
    assert basename.endswith(".pdf")
    assert len(basename.encode("utf-8")) < 255
    with open(path, "rb") as fh:
        assert fh.read() == b"payload"


def test_save_attachment_does_not_create_nested_directories(monkeypatch, tmp_path):
    monkeypatch.setattr(fetcher, "ATTACHMENT_STORAGE", str(tmp_path))

    path = fetcher._save_attachment(9, "../../escape.txt", b"x")

    assert os.path.dirname(path) == str(tmp_path / "9")
    assert not (tmp_path / "escape.txt").exists()
    assert os.path.isfile(path)


def test_parse_date_handles_malformed_headers():
    assert fetcher._parse_date("") is None
    assert fetcher._parse_date("not a real date") is None
    assert fetcher._parse_date("0000-00-00") is None

    parsed = fetcher._parse_date("Wed, 28 Oct 2026 09:40:09 +0000")
    assert parsed is not None
    assert parsed.year == 2026


def test_sanitize_clamps_to_column_limits():
    assert fetcher._sanitize("x" * 1000, 512) == "x" * 512
    assert fetcher._sanitize("a\x00b") == "ab"
    assert fetcher._sanitize(None, 10) == ""


def test_is_fatal_storage_error():
    assert fetcher._is_fatal_storage_error(OSError(errno.ENOSPC, "full"))
    assert fetcher._is_fatal_storage_error(OSError(errno.EDQUOT, "quota"))
    assert fetcher._is_fatal_storage_error(OSError(errno.EROFS, "read-only"))
    assert fetcher._is_fatal_storage_error(OSError(errno.EACCES, "denied"))
    assert not fetcher._is_fatal_storage_error(OSError(errno.ENAMETOOLONG, "long"))
    assert not fetcher._is_fatal_storage_error(ValueError("nope"))


def test_get_folder_state_closes_its_session(monkeypatch):
    class FakeQuery:
        def filter(self, *args, **kwargs):
            return self

        def order_by(self, *args, **kwargs):
            return self

        def first(self):
            return None

    class FakeSession:
        def __init__(self):
            self.closed = False

        def query(self, *args):
            return FakeQuery()

        def close(self):
            self.closed = True

    fake_session = FakeSession()
    monkeypatch.setattr(fetcher, "get_session", lambda: fake_session)

    assert fetcher._get_folder_state(1, "INBOX") == (None, None)
    assert fake_session.closed is True
