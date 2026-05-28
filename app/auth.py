from __future__ import annotations

import logging
import os
import secrets
from datetime import datetime, timezone
from functools import lru_cache
from typing import Optional

import bcrypt

from app.database import get_session
from app.models import User, SessionToken

logger = logging.getLogger(__name__)


# =========================================================
# PASSWORD HASHING (bcrypt)
# =========================================================


def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def _verify_password_old(password: str, stored_hash: str, salt: str) -> bool:
    import hashlib
    key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100000)
    return secrets.compare_digest(key.hex(), stored_hash)


def _is_bcrypt(stored_hash: str) -> bool:
    return stored_hash.startswith("$2b$") or stored_hash.startswith("$2a$")


def _verify_password(password: str, stored_hash: str) -> bool:
    if _is_bcrypt(stored_hash):
        try:
            return bcrypt.checkpw(password.encode(), stored_hash.encode())
        except Exception:
            return False
    # legacy pbkdf2 format: salt:hexdigest
    parts = stored_hash.split(":", 1)
    if len(parts) == 2:
        return _verify_password_old(password, parts[1], parts[0])
    return False


# =========================================================
# USERS
# =========================================================


def _invalidate_has_users_cache():
    cached_has_users.cache_clear()


@lru_cache(maxsize=1)
def cached_has_users() -> bool:
    session = get_session()
    try:
        return session.query(User).count() > 0
    finally:
        session.close()


def has_users() -> bool:
    return cached_has_users()


def create_user(username: str, password: str, is_admin: bool = True) -> User:
    pw_hash = _hash_password(password)
    session = get_session()
    try:
        user = User(
            username=username,
            password_hash=pw_hash,
            is_admin=is_admin,
        )
        session.add(user)
        session.commit()
        _invalidate_has_users_cache()
        logger.info("User created: %s (admin=%s)", username, is_admin)
        return user
    finally:
        session.close()


def verify_user(username: str, password: str) -> Optional[User]:
    session = get_session()
    try:
        user = session.query(User).filter(User.username == username).first()
        if not user:
            return None
        if _verify_password(password, user.password_hash):
            if not _is_bcrypt(user.password_hash):
                user.password_hash = _hash_password(password)
                session.commit()
                logger.info("Password rehashed to bcrypt for user %s", username)
            return user
        return None
    finally:
        session.close()


# =========================================================
# SESSIONS
# =========================================================


def create_session(user_id: int) -> str:
    token = secrets.token_hex(32)
    session = get_session()
    try:
        st = SessionToken(token=token, user_id=user_id)
        session.add(st)
        session.commit()
        logger.info("Session created for user_id=%d", user_id)
        return token
    finally:
        session.close()


def validate_session(token: str) -> Optional[int]:
    session = get_session()
    try:
        st = (
            session.query(SessionToken)
            .filter(SessionToken.token == token)
            .first()
        )
        if st is None:
            return None
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        expires = st.expires_at.replace(tzinfo=None) if st.expires_at else None
        if expires is not None and now > expires:
            session.delete(st)
            session.commit()
            logger.info("Expired session deleted: %s...", token[:12])
            return None
        return st.user_id
    except Exception:
        return None
    finally:
        session.close()


def revoke_session(token: str) -> None:
    session = get_session()
    try:
        st = session.query(SessionToken).filter(SessionToken.token == token).first()
        if st:
            session.delete(st)
            session.commit()
            logger.info("Session revoked: %s...", token[:12])
    finally:
        session.close()


def cleanup_expired_sessions() -> int:
    session = get_session()
    try:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        deleted = (
            session.query(SessionToken)
            .filter(SessionToken.expires_at < now)
            .delete()
        )
        session.commit()
        if deleted:
            logger.info("Cleaned up %d expired sessions", deleted)
        return deleted
    finally:
        session.close()
