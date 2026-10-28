from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

import yaml
from pydantic import BaseModel, Field


class AccountConfig(BaseModel):
    name: str
    email: str
    imap_server: str
    imap_port: int = 993
    imap_use_ssl: bool = True
    username: str = ""
    password: str = ""
    folders: list[str] = Field(default_factory=lambda: ["INBOX"])


class OAuthMicrosoftConfig(BaseModel):
    client_id: str = ""
    client_secret: str = ""
    redirect_uri: str = "http://localhost:8765/api/oauth/microsoft/callback"


class AppConfig(BaseModel):
    db_path: str = "mailsilo.db"
    data_dir: str = "data"
    host: str = "0.0.0.0"
    port: int = 8765
    password: str = ""
    accounts: list[AccountConfig] = Field(default_factory=list)
    fetch_interval_minutes: int = 30
    oauth: OAuthMicrosoftConfig = Field(default_factory=OAuthMicrosoftConfig)


_CONFIG: Optional[AppConfig] = None


def load_config(path: str | Path = "config.yaml") -> AppConfig:
    global _CONFIG
    p = Path(path)
    alt = Path("data") / path
    if alt.exists():
        p = alt
    elif not p.exists():
        p = Path("/dev/null")
    raw = yaml.safe_load(p.read_text()) if p.name != "/dev/null" else {}
    if raw is None:
        raw = {}
    accts = [AccountConfig(**a) for a in raw.pop("accounts", [])]
    _CONFIG = AppConfig(accounts=accts, **raw)

    env_db = os.environ.get("DATABASE_URL")
    if env_db:
        _CONFIG.db_path = env_db

    return _CONFIG


def get_config() -> AppConfig:
    assert _CONFIG is not None, "config not loaded – call load_config first"
    return _CONFIG


def save_config(cfg: AppConfig, path: str | Path = "config.yaml") -> None:
    raw = cfg.model_dump()
    p = Path("data") / path
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w") as f:
        yaml.dump(raw, f, default_flow_style=False, allow_unicode=True)
