from __future__ import annotations

import logging
import time
from collections import defaultdict
from functools import lru_cache

from fastapi import Depends, HTTPException, Request

from app.auth import has_users, validate_session, revoke_session

logger = logging.getLogger(__name__)

# =========================================================
# RATE LIMITER
# =========================================================

_login_attempts: dict[str, list[float]] = defaultdict(list)
RATE_LIMIT_WINDOW = 300  # 5 minutes
RATE_LIMIT_MAX = 10  # max attempts per window


def _check_rate_limit(key: str) -> None:
    now = time.time()
    window_start = now - RATE_LIMIT_WINDOW
    attempts = _login_attempts[key]
    attempts[:] = [t for t in attempts if t > window_start]
    if len(attempts) >= RATE_LIMIT_MAX:
        raise HTTPException(429, "Demasiados intentos. Intenta de nuevo en 5 minutos.")
    attempts.append(now)


def _reset_rate_limit(key: str) -> None:
    _login_attempts.pop(key, None)


# =========================================================
# AUTH DEPENDENCY
# =========================================================


@lru_cache(maxsize=1)
def _cached_auth_enabled() -> bool:
    from app.database import get_session
    from app.models import Setting
    sess = get_session()
    try:
        setting = sess.query(Setting).filter(Setting.key == "auth_enabled").first()
        if setting and setting.value == "false":
            return False
        return True
    finally:
        sess.close()


def invalidate_auth_cache():
    _cached_auth_enabled.cache_clear()


def auth_enabled() -> bool:
    return _cached_auth_enabled()


def get_current_user(request: Request) -> dict | None:
    if not has_users():
        return None
    if not _cached_auth_enabled():
        return None
    auth = request.headers.get("Authorization", "")
    token = ""
    if auth.startswith("Bearer "):
        token = auth[7:]
    else:
        token = request.query_params.get("token", "")
    if not token:
        raise HTTPException(401, "Token requerido")
    user_id = validate_session(token)
    if not user_id:
        revoke_session(token)
        raise HTTPException(401, "Token inválido o expirado")

    from app.database import get_session
    from app.models import User

    session = get_session()
    try:
        user = session.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(401, "Usuario no encontrado")
        return {
            "id": user.id,
            "username": user.username,
            "is_admin": user.is_admin,
            "token": token,
        }
    finally:
        session.close()
