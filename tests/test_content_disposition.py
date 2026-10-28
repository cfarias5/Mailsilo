from __future__ import annotations

from app.api.emails import content_disposition


def test_content_disposition_handles_quotes_and_newlines():
    header = content_disposition('re"port\r\nX-Injected: 1.pdf')

    assert header.startswith("attachment;")
    assert "\r" not in header
    assert "\n" not in header
    assert "filename=\"re'portX-Injected: 1.pdf\"" in header
    assert "filename*=UTF-8''" in header


def test_content_disposition_uses_ascii_fallback_and_rfc5987_name():
    header = content_disposition("résumé.pdf")

    assert 'filename="rsum.pdf"' in header
    assert "filename*=UTF-8''r%C3%A9sum%C3%A9.pdf" in header


def test_content_disposition_defaults_to_adjunto():
    assert 'filename="adjunto"' in content_disposition(None)
    assert 'filename="adjunto"' in content_disposition("")
