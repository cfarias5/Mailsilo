# MailSilo

**Archivador de correos autogestionado** — Liberá espacio en la nube, evitá suscripciones caras y buscá tus correos localmente.

MailSilo es una solución de código abierto para respaldar, organizar y proteger tus correos electrónicos de forma local. Descarga desde cualquier servidor IMAP o importa archivos (EML, PST, OST, MBOX) a PostgreSQL, con una interfaz web rápida y búsqueda instantánea. La alternativa perfecta para no pagar de más por gigabytes extras en Google Workspace, Microsoft 365 o iCloud.

## Características

- 📥 **Sincronización IMAP** — descarga automática desde cualquier servidor IMAP
- 🔄 **Sincronización programada** — por cuenta (6h, 12h, 24h, 7d, 30d)
- 🔵 **OAuth Microsoft** — Outlook / Hotmail con OAuth 2.0
- 📄 **Importación EML** — archivos `.eml` individuales o en lote
- 🗂 **Importación PST / OST** — archivos de Outlook (requiere `readpst`)
- 📦 **Importación MBOX** — archivos mbox con progreso en tiempo real
- 🔍 **Búsqueda de texto completo** — por asunto, remitente o cuerpo (PostgreSQL FTS + LIKE)
- 📤 **Reenvío SMTP** — reenviá correos archivados a destinatarios externos
- 📦 **Exportación MBOX** — exportá por cuenta, búsqueda o selección
- 🗑 **Borrado masivo** — seleccioná y eliminá múltiples correos
- 🌐 **Interfaz web** — SPA con JavaScript vanilla, sidebar, modo oscuro/claro
- 👥 **Multi-cuenta** — administrá múltiples cuentas de correo
- 🔐 **Autenticación opcional** — protección con contraseña (bcrypt)
- 🔒 **Contraseñas cifradas** — credenciales almacenadas cifradas con Fernet
- 🐳 **Docker** — despliegue con un solo comando

## Requisitos

- Docker y Docker Compose
- PostgreSQL (se inicia automáticamente con docker compose)
- `readpst` (para importar PST/OST — incluido en la imagen Docker)

## Inicio rápido

```bash
# Iniciar con valores predeterminados (sin configuración previa)
docker compose up -d
```

Abrí http://localhost:8765

En la primera ejecución se te pedirá crear un usuario administrador.

### Configuración personalizada (opcional)

```bash
cp .env.example .env
# Editá .env si necesitas credenciales personalizadas de PostgreSQL o un Tunnel de Cloudflare
docker compose up -d
```

## Configuración

### Variables de entorno (`.env`)

| Variable | Descripción | Por defecto |
|---|---|---|
| `POSTGRES_PASSWORD` | Contraseña de PostgreSQL | `mailsilo_local_dev` |
| `POSTGRES_DB` | Nombre de la base de datos | `mailsilo` |
| `POSTGRES_USER` | Usuario de PostgreSQL | `mailsilo` |
| `TUNNEL_TOKEN` | Token de Cloudflare Tunnel (opcional) | — |

### Proxy inverso (NGINX, Caddy, etc.)

MailSilo corre en el puerto `8765`. Podés ponerlo detrás de un reverse proxy:

#### NGINX

```nginx
server {
    listen 80;
    server_name mailsilo.tudominio.com;

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
mailsilo.tudominio.com {
    reverse_proxy 127.0.0.1:8765
}
```

Caddy maneja HTTPS automático con Let's Encrypt. Para NGINX agregá un bloque `listen 443 ssl` con tus certificados.

## Importación de correos

| Formato | Extensión | Lote | Progreso |
|---|---|---|---|
| EML | `.eml` | ✅ múltiples archivos | ✅ |
| PST | `.pst` | ✅ secuencial | ✅ en tiempo real |
| OST | `.ost` | ✅ secuencial | ✅ en tiempo real |
| MBOX | `.mbox` | ✅ secuencial | ✅ en tiempo real |

Los archivos grandes se procesan en segundo plano con barra de progreso en el sidebar. Si la conexión se pierde durante la subida, el cliente recupera la tarea automáticamente.

## Reenvío SMTP

Configurá un servidor SMTP en Ajustes → Reenvío de correos (SMTP). Compatible con Gmail, Outlook, iCloud, Yahoo y cualquier SMTP genérico (puerto 587 con TLS o 465 sin TLS). Incluye botón de prueba para verificar las credenciales.

## Seguridad

- Las contraseñas IMAP y SMTP se cifran con **Fernet** (cryptography)
- La clave de cifrado se genera automáticamente en la primera ejecución
- Autenticación opcional con bcrypt
- Las cuentas importadas se marcan como `is_imported` y no intentan sincronizar

## Desarrollo

```bash
git clone ...
cd mailsilo
pip install -e .
# Requiere una instancia de PostgreSQL corriendo
uvicorn app.main:app --reload --port 8765
```

## Estructura del proyecto

```
app/
├── api/           # Endpoints FastAPI
│   ├── accounts.py
│   ├── emails.py
│   ├── imports.py
│   ├── settings.py
│   └── ...
├── importers/     # Motores de importación
│   ├── eml.py
│   ├── mbox.py
│   ├── pst.py
│   └── ...
├── imap/          # Motor de sincronización IMAP
├── models/        # Modelos SQLAlchemy
├── services/      # Lógica de negocio
├── static/        # Frontend (JavaScript vanilla + CSS)
├── templates/     # Plantillas HTML
├── crypto.py      # Cifrado Fernet
├── database.py    # Conexión y migraciones
└── main.py        # Punto de entrada
```

## 💰 Apoyá el proyecto

MailSilo es un proyecto de código abierto independiente. Si te está ayudando a ahorrar en almacenamiento de correo, considerá apoyar su desarrollo:

- ☕ [Cafecito](https://buymeacoffee.com/cfarias5)
- 🚀 GitHub Sponsors (próximamente)

*Planes a futuro: aplicación móvil nativa y sincronización en la nube.*

## Licencia

MIT License — consultá [LICENSE](LICENSE) para más detalles.
