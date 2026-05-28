from __future__ import annotations

import logging
import os

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.auth import (
    has_users,
    create_user,
    verify_user,
    create_session,
)
from app.api.deps import get_current_user, _check_rate_limit, _reset_rate_limit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class SetupRequest(BaseModel):
    username: str
    password: str


SETUP_LOCKED = os.environ.get("SETUP_LOCKED", "").lower() in ("1", "true", "yes")


@router.get("/status")
def auth_status():
    from app.api.deps import auth_enabled
    return {"has_users": has_users(), "auth_enabled": auth_enabled()}


@router.post("/login")
def login(data: LoginRequest, request: Request):
    _check_rate_limit(request.client.host if request.client else "unknown")
    logger.info("Login attempt: %s from %s", data.username, request.client.host if request.client else "?")

    if not has_users():
        raise HTTPException(400, "No hay usuarios. Crea el primero via setup.")

    if len(data.password) < 8:
        logger.warning("Failed login (short pw): %s", data.username)
        raise HTTPException(401, "Usuario o contraseña incorrectos")

    user = verify_user(data.username, data.password)
    if not user:
        logger.warning("Failed login: %s from %s", data.username, request.client.host if request.client else "?")
        raise HTTPException(401, "Usuario o contraseña incorrectos")

    token = create_session(user.id)
    _reset_rate_limit(request.client.host if request.client else "unknown")
    logger.info("Login OK: %s", data.username)

    return {
        "token": token,
        "user": {
            "id": user.id,
            "username": user.username,
            "is_admin": user.is_admin,
        },
    }


@router.post("/setup")
def setup(data: SetupRequest, request: Request):
    if SETUP_LOCKED:
        raise HTTPException(403, "Setup bloqueado por configuración")
    if has_users():
        raise HTTPException(403, "Ya hay usuarios configurados")

    if len(data.username) < 2:
        raise HTTPException(400, "El usuario debe tener al menos 2 caracteres")
    if len(data.password) < 8:
        raise HTTPException(400, "La contraseña debe tener al menos 8 caracteres")

    has_upper = any(c.isupper() for c in data.password)
    has_lower = any(c.islower() for c in data.password)
    has_digit = any(c.isdigit() for c in data.password)
    if not (has_upper and has_lower and has_digit):
        raise HTTPException(400, "La contraseña debe tener mayúscula, minúscula y número")

    logger.info("Setup user: %s from %s", data.username, request.client.host if request.client else "?")
    user = create_user(data.username, data.password, is_admin=True)
    token = create_session(user.id)

    return {
        "token": token,
        "user": {
            "id": user.id,
            "username": user.username,
            "is_admin": user.is_admin,
        },
    }


@router.get("/me")
def me(user: dict = Depends(get_current_user)):
    if not user:
        return {"authenticated": False}
    return {
        "authenticated": True,
        **user,
    }
