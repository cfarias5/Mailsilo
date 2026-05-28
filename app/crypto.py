from __future__ import annotations

import logging

from cryptography.fernet import Fernet

from app.models import Setting
from app.database import get_session

logger = logging.getLogger(__name__)

_fernet: Fernet | None = None


def _load_or_create_key() -> bytes:
    session = get_session()
    try:
        row = session.query(Setting).filter(Setting.key == "crypto_key").first()
        if row and row.value:
            return row.value.encode()
        key = Fernet.generate_key()
        session.add(Setting(key="crypto_key", value=key.decode()))
        session.commit()
        return key
    finally:
        session.close()


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        _fernet = Fernet(_load_or_create_key())
    return _fernet


def encrypt(plaintext: str) -> str:
    if not plaintext:
        return ""
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    if not ciphertext:
        return ""
    try:
        return _get_fernet().decrypt(ciphertext.encode()).decode()
    except Exception as e:
        logger.warning("Decryption failed: %s", e)
        return ciphertext
