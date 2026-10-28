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
    generate_backup_codes,
    reset_password_with_backup_code,
    remaining_backup_codes,
    invalidate_backup_codes,
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


class BackupCodeResetRequest(BaseModel):
    username: str
    code: str
    new_password: str


class GenerateBackupCodesRequest(BaseModel):
    username: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


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
    codes = generate_backup_codes(user.id)
    token = create_session(user.id)

    return {
        "token": token,
        "user": {
            "id": user.id,
            "username": user.username,
            "is_admin": user.is_admin,
        },
        "backup_codes": codes,
    }


@router.get("/me")
def me(user: dict = Depends(get_current_user)):
    if not user:
        return {"authenticated": False}
    return {
        "authenticated": True,
        **user,
    }


@router.put("/change-password")
def change_password(data: ChangePasswordRequest, user: dict = Depends(get_current_user)):
    if not user:
        raise HTTPException(401, "No autenticado")
    if len(data.new_password) < 8:
        raise HTTPException(400, "La contraseña debe tener al menos 8 caracteres")
    has_upper = any(c.isupper() for c in data.new_password)
    has_lower = any(c.islower() for c in data.new_password)
    has_digit = any(c.isdigit() for c in data.new_password)
    if not (has_upper and has_lower and has_digit):
        raise HTTPException(400, "La contraseña debe tener mayúscula, minúscula y número")
    from app.auth import _hash_password
    from app.database import get_session
    from app.models import User
    session = get_session()
    try:
        db_user = session.query(User).filter(User.id == user["id"]).first()
        if not db_user:
            raise HTTPException(404, "Usuario no encontrado")
        from app.auth import verify_user
        if not verify_user(db_user.username, data.current_password):
            raise HTTPException(401, "Contraseña actual incorrecta")
        db_user.password_hash = _hash_password(data.new_password)
        session.commit()
        logger.info("Password changed for user_id=%d", user["id"])
        return {"message": "Contraseña cambiada correctamente"}
    finally:
        session.close()


@router.post("/reset-with-backup-code")
def reset_with_backup_code(data: BackupCodeResetRequest):
    if len(data.new_password) < 8:
        raise HTTPException(400, "La contraseña debe tener al menos 8 caracteres")
    has_upper = any(c.isupper() for c in data.new_password)
    has_lower = any(c.islower() for c in data.new_password)
    has_digit = any(c.isdigit() for c in data.new_password)
    if not (has_upper and has_lower and has_digit):
        raise HTTPException(400, "La contraseña debe tener mayúscula, minúscula y número")
    if not reset_password_with_backup_code(data.username, data.code, data.new_password):
        raise HTTPException(400, "Código de respaldo inválido o ya usado")
    return {"message": "Contraseña restablecida correctamente"}


@router.get("/backup-codes-remaining/{username}")
def backup_codes_remaining(username: str):
    count = remaining_backup_codes(username)
    return {"remaining": count}


@router.post("/admin-generate-backup-codes")
def admin_generate_backup_codes(data: GenerateBackupCodesRequest, user: dict = Depends(get_current_user)):
    if not user or not user.get("is_admin"):
        raise HTTPException(403, "Solo administradores")
    session = None
    try:
        from app.database import get_session
        from app.models import User
        session = get_session()
        u = session.query(User).filter(User.username == data.username).first()
        if not u:
            raise HTTPException(404, "Usuario no encontrado")
    finally:
        if session:
            session.close()
    invalidate_backup_codes(u.id)
    codes = generate_backup_codes(u.id)
    logger.info("Admin generated new backup codes for username=%s", data.username)
    return {"backup_codes": codes}
