from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import get_current_user

router = APIRouter(
    prefix="/api/settings",
    tags=["settings"],
    dependencies=[Depends(get_current_user)],
)


class OAuthMicrosoftSettings(BaseModel):
    client_id: str = ""
    client_secret: str = ""
    redirect_uri: str = ""


class AuthSettings(BaseModel):
    enabled: bool = True


@router.get("/oauth/microsoft")
def get_oauth_microsoft_settings():
    from app.database import get_session
    from app.models import Setting
    session = get_session()
    try:
        row = session.query(Setting).filter(Setting.key == "oauth_microsoft").first()
        if not row or not row.value:
            return {
                "client_id": "",
                "client_secret": "",
                "redirect_uri": "",
            }
        return json.loads(row.value)
    finally:
        session.close()


@router.put("/oauth/microsoft")
def update_oauth_microsoft_settings(
    data: OAuthMicrosoftSettings,
):
    from app.database import get_session
    from app.models import Setting
    session = get_session()
    try:
        row = session.query(Setting).filter(Setting.key == "oauth_microsoft").first()
        value = json.dumps(data.model_dump())
        if row:
            row.value = value
        else:
            session.add(Setting(key="oauth_microsoft", value=value))
        session.commit()
        return {"ok": True}
    finally:
        session.close()


# =========================================================
# AUTH SETTINGS
# =========================================================


@router.put("/auth")
def update_auth_settings(data: AuthSettings):
    from app.database import get_session
    from app.models import Setting
    from app.api.deps import invalidate_auth_cache
    session = get_session()
    try:
        row = session.query(Setting).filter(Setting.key == "auth_enabled").first()
        val = "true" if data.enabled else "false"
        if row:
            row.value = val
        else:
            session.add(Setting(key="auth_enabled", value=val))
        session.commit()
        invalidate_auth_cache()
        return {"ok": True}
    finally:
        session.close()


# =========================================================
# GLOBAL SMTP SETTINGS
# =========================================================


class SmtpSettings(BaseModel):
    server: str = ""
    port: int = 587
    use_ssl: bool = True
    username: str = ""
    password: str = ""


@router.get("/smtp")
def get_smtp_settings():
    from app.database import get_session
    from app.models import Setting
    session = get_session()
    try:
        row = session.query(Setting).filter(Setting.key == "smtp").first()
        if not row or not row.value:
            return {"server": "", "port": 587, "use_ssl": True, "username": "", "has_password": False}
        data = json.loads(row.value)
        return {
            "server": data.get("server", ""),
            "port": data.get("port", 587),
            "use_ssl": data.get("use_ssl", True),
            "username": data.get("username", ""),
            "has_password": bool(data.get("password")),
        }
    finally:
        session.close()


@router.put("/smtp")
def update_smtp_settings(data: SmtpSettings):
    from app.database import get_session
    from app.models import Setting
    session = get_session()
    try:
        row = session.query(Setting).filter(Setting.key == "smtp").first()
        # Merge with existing to avoid clearing password if not sent
        existing = {}
        if row and row.value:
            existing = json.loads(row.value)
        from app.crypto import encrypt
        if data.password:
            existing["password"] = encrypt(data.password)
        elif data.password == "" and "password" in existing:
            # Only clear password if explicitly sent as empty string
            pass
        existing["server"] = data.server
        existing["port"] = data.port
        existing["use_ssl"] = data.use_ssl
        existing["username"] = data.username
        value = json.dumps(existing)
        if row:
            row.value = value
        else:
            session.add(Setting(key="smtp", value=value))
        session.commit()
        return {"ok": True}
    finally:
        session.close()


@router.post("/smtp/test")
def test_smtp_settings():
    import smtplib
    from app.database import get_session
    from app.models import Setting
    session = get_session()
    try:
        row = session.query(Setting).filter(Setting.key == "smtp").first()
        if not row or not row.value:
            raise HTTPException(status_code=400, detail="No hay configuración SMTP guardada")
        smtp_cfg = json.loads(row.value)
        server_host = smtp_cfg.get("server", "")
        port = smtp_cfg.get("port", 587)
        use_ssl = smtp_cfg.get("use_ssl", True)
        username = smtp_cfg.get("username", "")
        password = smtp_cfg.get("password", "")
        if not server_host:
            raise HTTPException(status_code=400, detail="Servidor SMTP no configurado")
        if not username or not password:
            raise HTTPException(status_code=400, detail="Usuario o contraseña no configurados")
        from app.crypto import decrypt
        password = decrypt(password)
        srv = smtplib.SMTP(server_host, port, timeout=15)
        if use_ssl:
            srv.starttls()
        if username and password:
            srv.login(username, password)
        srv.quit()
        return {"ok": True, "message": "✅ Conexión SMTP exitosa"}
    except smtplib.SMTPAuthenticationError:
        raise HTTPException(status_code=400, detail="Error de autenticación SMTP. Verifica usuario y contraseña.")
    except smtplib.SMTPException as e:
        raise HTTPException(status_code=400, detail=f"Error SMTP: {e}")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error al conectar: {e}")
    finally:
        session.close()
