# MailSilo

**Self-hosted email archiver** — Free up cloud space, avoid expensive subscriptions, and search your emails locally.

MailSilo is an open-source solution to back up, organize, and protect your emails locally. Download from any IMAP server or import files (EML, PST, OST, MBOX) into PostgreSQL, with a fast web interface and instant search. The perfect alternative to avoid paying extra for additional gigabytes in Google Workspace, Microsoft 365, or iCloud.

## Features

- 📥 **IMAP sync** — automatic download from any IMAP server
- 🔄 **Scheduled sync** — per account (6h, 12h, 24h, 7d, 30d)
- 🔵 **Microsoft OAuth** — Outlook / Hotmail with OAuth 2.0
- 📄 **EML import** — single or batch `.eml` files
- 🗂 **PST / OST import** — Outlook files (requires `readpst`)
- 📦 **MBOX import** — mbox files with real-time progress
- 🔍 **Full-text search** — by subject, sender or body (PostgreSQL FTS + LIKE)
- 📤 **SMTP forwarding** — forward archived emails to external recipients
- 📦 **MBOX export** — export by account, search or selection
- 🗑 **Bulk delete** — select and delete multiple emails
- 🌐 **Web interface** — vanilla JS SPA with sidebar, dark/light mode
- 👥 **Multi-account** — manage multiple email accounts
- 🔐 **Optional authentication** — password protection (bcrypt)
- 🔒 **Encrypted passwords** — credentials stored encrypted with Fernet
- 🐳 **Docker** — single-command deployment

## Requirements

- Docker and Docker Compose
- PostgreSQL (starts automatically with docker compose)
- `readpst` (for PST/OST import — included in the Docker image)

## Quick start

### Option A — Pull from Docker Hub (recommended)

This is the simplest method. It uses `docker compose` which automatically creates the network, volumes, and starts PostgreSQL:

```bash
# 1. Create a .env file (or copy from .env.example)
cp .env.example .env

# 2. Start everything (PostgreSQL + MailSilo)
docker compose up -d
```

Open http://localhost:8765

On first run you will be prompted to create an admin user.

> **Note:** Using just `docker run` is not recommended — you'd need to manually set up a PostgreSQL container, create a shared network, and pass the `DATABASE_URL` environment variable. Stick with `docker compose` for a seamless setup.

### Option B — Build locally

```bash
# Start with default values (no prior setup)
docker compose up -d
```

Open http://localhost:8765

On first run you will be prompted to create an admin user.

### Custom configuration (optional)

```bash
# Edit .env if you need custom PostgreSQL credentials or a Cloudflare Tunnel
docker compose up -d
```

## Configuration

### Environment variables (`.env`)

| Variable | Description | Default |
|---|---|---|
| `POSTGRES_PASSWORD` | PostgreSQL password | `mailsilo_local_dev` |
| `POSTGRES_DB` | Database name | `mailsilo` |
| `POSTGRES_USER` | PostgreSQL user | `mailsilo` |
| `TUNNEL_TOKEN` | Cloudflare Tunnel token (optional) | — |

### Reverse proxy (NGINX, Caddy, etc.)

MailSilo runs on port `8765`. You can put it behind a reverse proxy:

#### NGINX

```nginx
server {
    listen 80;
    server_name mailsilo.yourdomain.com;

    client_max_body_size 10G;

    location / {
        proxy_pass http://127.0.0.1:8765;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

#### Caddy

```
mailsilo.yourdomain.com {
    reverse_proxy 127.0.0.1:8765
}
```

Caddy handles automatic HTTPS with Let's Encrypt. For NGINX, add a `listen 443 ssl` block with your certificates.

## Email import

| Format | Extension | Batch | Progress |
|---|---|---|---|
| EML | `.eml` | ✅ multiple files | ✅ |
| PST | `.pst` | ✅ sequential | ✅ real-time |
| OST | `.ost` | ✅ sequential | ✅ real-time |
| MBOX | `.mbox` | ✅ sequential | ✅ real-time |

Large files are processed in the background with a progress bar in the sidebar. If the connection drops during upload, the client automatically recovers the task.

## SMTP forwarding

Configure an SMTP server in Settings → Email forwarding (SMTP). Compatible with Gmail, Outlook, iCloud, Yahoo and any generic SMTP (port 587 with TLS or 465 without TLS). Includes a test button to verify credentials.

## Security

- IMAP and SMTP passwords are encrypted with **Fernet** (cryptography)
- The encryption key is automatically generated on first run
- Optional authentication with bcrypt
- Imported accounts are marked as `is_imported` and won't attempt to sync

## Development

```bash
git clone ...
cd mailsilo
pip install -e .
# Requires a running PostgreSQL instance
uvicorn app.main:app --reload --port 8765
```

## Project structure

```
app/
├── api/           # FastAPI endpoints
│   ├── accounts.py
│   ├── emails.py
│   ├── imports.py
│   ├── settings.py
│   └── ...
├── importers/     # Import engines
│   ├── eml.py
│   ├── mbox.py
│   ├── pst.py
│   └── ...
├── imap/          # IMAP sync engine
├── models/        # SQLAlchemy models
├── services/      # Business logic
├── static/        # Frontend (vanilla JavaScript + CSS)
├── templates/     # HTML templates
├── crypto.py      # Fernet encryption
├── database.py    # Connection and migrations
└── main.py        # Entry point
```

## 💰 Support the project

MailSilo is an independent open-source project. If it's helping you save on email storage, consider supporting its development:

- ☕ [Buy Me a Coffee](https://buymeacoffee.com/cfarias5)
- 🚀 GitHub Sponsors (coming soon)

*Future plans: native mobile app and cloud sync.*

## License

MIT License — see [LICENSE](LICENSE) for details.
