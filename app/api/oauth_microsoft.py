from __future__ import annotations

import json
import logging
import secrets
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse, HTMLResponse
from sqlalchemy.orm import Session

from app.database import get_session
from app.models import Account, Setting
from app.api.deps import get_current_user
from app.config import get_config

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/oauth/microsoft",
    tags=["oauth-microsoft"],
)

# Temporary storage for OAuth state -> (email, state_expiry)
_OAUTH_STATES: dict[str, dict] = {}

# Temporary storage for pending tokens keyed by email
PENDING_OAUTH_TOKENS: dict[str, dict] = {}

AUTHORIZE_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
SCOPES = "openid offline_access https://outlook.office.com/IMAP.AccessAsUser.All"


def _get_oauth_config():
    import json
    # Try DB first
    session = get_session()
    try:
        row = session.query(Setting).filter(Setting.key == "oauth_microsoft").first()
        if row and row.value:
            data = json.loads(row.value)
            if data.get("client_id") and data.get("client_secret"):
                return data
    except Exception:
        pass
    finally:
        session.close()

    # Fallback to config.yaml
    cfg = get_config().oauth
    if cfg.client_id and cfg.client_secret:
        return {
            "client_id": cfg.client_id,
            "client_secret": cfg.client_secret,
            "redirect_uri": cfg.redirect_uri,
        }

    raise HTTPException(status_code=400, detail="Microsoft OAuth no está configurado. Ve a Configuración → Outlook OAuth para configurarlo.")


@router.get("/login")
def microsoft_login(
    email: str = Query(...),
    user: dict = Depends(get_current_user),
):
    oauth = _get_oauth_config()
    state = secrets.token_urlsafe(32)
    _OAUTH_STATES[state] = {
        "email": email,
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=10),
    }

    params = (
        f"?client_id={oauth['client_id']}"
        f"&response_type=code"
        f"&redirect_uri={oauth['redirect_uri']}"
        f"&scope={SCOPES.replace(' ', '%20')}"
        f"&state={state}"
        f"&login_hint={email}"
    )
    return RedirectResponse(url=AUTHORIZE_URL + params)


@router.get("/callback")
async def microsoft_callback(
    code: str = Query(...),
    state: str = Query(...),
    error: str | None = Query(None),
):
    if error:
        return HTMLResponse(
            f"<h2 style='color:#ef4444;font-family:sans-serif;text-align:center;margin-top:3rem'>"
            f"❌ Error de autorización: {error}</h2>"
            f"<p style='text-align:center;font-family:sans-serif;color:#666'>"
            f"Puedes cerrar esta ventana e intentarlo de nuevo.</p>"
        )

    stored = _OAUTH_STATES.pop(state, None)
    if not stored:
        return HTMLResponse(
            "<h2 style='color:#ef4444;font-family:sans-serif;text-align:center;margin-top:3rem'>"
            "❌ Estado inválido o expirado</h2>"
            "<p style='text-align:center;font-family:sans-serif;color:#666'>"
            "Puedes cerrar esta ventana e intentarlo de nuevo.</p>"
        )

    if datetime.now(timezone.utc) > stored["expires_at"]:
        return HTMLResponse(
            "<h2 style='color:#ef4444;font-family:sans-serif;text-align:center;margin-top:3rem'>"
            "❌ Estado expirado</h2>"
            "<p style='text-align:center;font-family:sans-serif;color:#666'>"
            "Puedes cerrar esta ventana e intentarlo de nuevo.</p>"
        )

    email = stored["email"]
    oauth = _get_oauth_config()

    import httpx

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                TOKEN_URL,
                data={
                    "client_id": oauth["client_id"],
                    "client_secret": oauth["client_secret"],
                    "code": code,
                    "redirect_uri": oauth["redirect_uri"],
                    "grant_type": "authorization_code",
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            token_data = resp.json()

        if resp.status_code != 200:
            logger.error("Token exchange failed: %s", token_data)
            return HTMLResponse(
                f"<h2 style='color:#ef4444;font-family:sans-serif;text-align:center;margin-top:3rem'>"
                f"❌ Error al obtener token: {token_data.get('error_description', 'desconocido')}</h2>"
                f"<p style='text-align:center;font-family:sans-serif;color:#666'>"
                f"Puedes cerrar esta ventana e intentarlo de nuevo.</p>"
            )

        expires_in = token_data.get("expires_in", 3600)
        PENDING_OAUTH_TOKENS[email] = {
            "access_token": token_data["access_token"],
            "refresh_token": token_data.get("refresh_token", ""),
            "expiry": (datetime.now(timezone.utc) + timedelta(seconds=expires_in)).isoformat(),
            "provider": "microsoft",
        }

        return HTMLResponse(
            "<!DOCTYPE html><html><head><meta charset='utf-8'>"
            "<title>Conectado</title>"
            "<style>"
            "body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:80vh;margin:0;background:#f5f5f5}"
            ".card{background:#fff;border-radius:12px;padding:2rem;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.1);max-width:400px}"
            ".icon{font-size:3rem;margin-bottom:.5rem}"
            "h2{color:#22c55e;margin:0 0 .5rem}"
            "p{color:#666;font-size:.9rem;line-height:1.5}"
            "</style></head><body>"
            "<div class='card'>"
            "<div class='icon'>✅</div>"
            "<h2>Cuenta conectada</h2>"
            f"<p>Microsoft Outlook se ha vinculado correctamente con <strong>{email}</strong>.</p>"
            "<p>Ya puedes cerrar esta ventana y guardar la cuenta en MailSilo.</p>"
            "</div></body></html>"
        )

    except Exception as e:
        logger.exception("OAuth callback error")
        return HTMLResponse(
            f"<h2 style='color:#ef4444;font-family:sans-serif;text-align:center;margin-top:3rem'>"
            f"❌ Error: {e}</h2>"
        )


@router.get("/tokens")
def get_pending_tokens(email: str = Query(...), user: dict = Depends(get_current_user)):
    email_lower = email.lower().strip()
    tokens = PENDING_OAUTH_TOKENS.get(email_lower)
    if not tokens:
        return {"connected": False}
    return {
        "connected": True,
        "provider": tokens["provider"],
        "expiry": tokens["expiry"],
    }


@router.get("/status")
def oauth_status(user: dict = Depends(get_current_user)):
    try:
        oauth = _get_oauth_config()
        configured = bool(oauth.get("client_id") and oauth.get("client_secret"))
    except HTTPException:
        configured = False
    return {"configured": configured}


# =========================================================
# TOKEN REFRESH
# =========================================================

def refresh_microsoft_token(account: Account) -> str | None:
    if not account.oauth_refresh_token:
        return None

    oauth = _get_oauth_config()
    if not oauth.get("client_id") or not oauth.get("client_secret"):
        return None

    import httpx

    try:
        resp = httpx.post(
            TOKEN_URL,
            data={
                "client_id": oauth["client_id"],
                "client_secret": oauth["client_secret"],
                "refresh_token": account.oauth_refresh_token,
                "grant_type": "refresh_token",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        data = resp.json()
        if resp.status_code != 200:
            logger.error("Token refresh failed for %s: %s", account.email, data)
            return None

        new_access = data["access_token"]
        new_refresh = data.get("refresh_token", account.oauth_refresh_token)
        expires_in = data.get("expires_in", 3600)

        session = get_session()
        try:
            acct = session.query(Account).filter(Account.id == account.id).first()
            if acct:
                acct.oauth_refresh_token = new_refresh
                acct.oauth_token_expiry = datetime.now(timezone.utc) + timedelta(seconds=expires_in)
                session.commit()
        finally:
            session.close()

        return new_access

    except Exception as e:
        logger.exception("Error refreshing token for %s", account.email)
        return None
