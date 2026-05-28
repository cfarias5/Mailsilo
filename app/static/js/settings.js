async function renderSettings() {
  setSplitView(false);
  setListTitle("Configuración", "");
  showDetailEmpty();

  const saved = getSavedTheme();
  let stats = { total_emails: 0, total_accounts: 0, total_size: 0 };
  try { stats = await api("/api/stats"); } catch (e) {}

  // Get current auth setting
  let authEnabled = true;
  try {
    const status = await fetch(API + "/api/auth/status").then(r => r.json());
    authEnabled = status.auth_enabled !== false;
  } catch (e) {}

  // Get global SMTP settings
  let smtp = { server: "", port: 587, use_ssl: true, username: "", has_password: false };
  try { smtp = await api("/api/settings/smtp"); } catch (e) {}

  const themeOpts = [
    { value: "auto", label: "Automático (claro de día, oscuro de noche)" },
    { value: "light", label: "Claro" },
    { value: "dark", label: "Oscuro" },
  ].map(x => `<option value="${x.value}" ${saved === x.value ? "selected" : ""}>${x.label}</option>`).join("");

  const now = new Date();
  const currentTheme = getAutoTheme();
  const nextChange = currentTheme === "light" ? "19:00 (oscuro)" : "7:00 (claro)";

  const authChecked = authEnabled ? "checked" : "";
  const pwPlaceholder = smtp.has_password ? "•••••••• (dejar vacío para mantener)" : "";

  $("#listPanelBody").innerHTML = `
      <div class="page-header"><h2>⚙️ Configuración</h2></div>

      <div class="settings-section">
        <h3>🎨 Apariencia</h3>
        <div class="settings-row">
          <label>Tema</label>
          <select class="settings-select" id="themeSelect" onchange="onThemeChange(this.value)">${themeOpts}</select>
        </div>
        <div style="font-size:.78rem;color:var(--text-tertiary);padding:.3rem .75rem">
          ${saved === "auto" ? `Cambio automático a las ${nextChange}` : "Tema fijo seleccionado"}
        </div>
      </div>

      <div class="settings-section">
        <h3>🔒 Seguridad</h3>
        <div class="settings-row">
          <label>Protección con contraseña</label>
          <label class="switch">
            <input type="checkbox" id="authToggle" ${authChecked} onchange="toggleAuth(this.checked)">
            <span class="switch-slider"></span>
          </label>
        </div>
        <div style="font-size:.78rem;color:var(--text-tertiary);padding:.3rem .75rem">
          ${authEnabled
            ? "Se requiere inicio de sesión para acceder a MailSilo"
            : "Cualquier persona puede acceder sin contraseña"}
        </div>
      </div>

      <div class="settings-section">
        <h3>📤 Reenvío de correos (SMTP)</h3>
        <div class="settings-row"><label>Servidor</label><input class="settings-input" id="smtpServer" value="${esc(smtp.server)}" placeholder="smtp.ejemplo.com"></div>
        <div class="settings-row"><label>Puerto</label><input class="settings-input" id="smtpPort" type="number" value="${smtp.port}" placeholder="587" style="width:100px"></div>
        <div class="settings-row">
          <label>SSL/TLS</label>
          <label class="switch">
            <input type="checkbox" id="smtpSsl" ${smtp.use_ssl ? "checked" : ""}>
            <span class="switch-slider"></span>
          </label>
        </div>
        <div class="settings-row"><label>Usuario</label><input class="settings-input" id="smtpUser" value="${esc(smtp.username)}" placeholder="tu@correo.com"></div>
        <div class="settings-row"><label>Contraseña</label><input class="settings-input" id="smtpPassword" type="password" placeholder="${esc(pwPlaceholder)}"></div>
        <div style="padding:.3rem .75rem;display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">
          <button class="btn-sm primary" onclick="saveSmtp()">💾 Guardar SMTP</button>
          <button class="btn-sm outline" onclick="testSmtp()">📤 Probar SMTP</button>
          <span id="smtpSaveMsg" style="font-size:.78rem"></span>
        </div>
        <div style="font-size:.78rem;color:var(--text-tertiary);padding:.3rem .75rem">
          Se usa para reenviar correos desde cualquier cuenta. El remitente (From) puede ser cualquier dirección que hayas descargado.
        </div>
      </div>

      <div class="settings-section">
        <h3>📊 Base de datos</h3>
        <div class="settings-row"><label>Correos almacenados</label><span style="color:var(--text)">${stats.total_emails}</span></div>
        <div class="settings-row"><label>Cuentas configuradas</label><span style="color:var(--text)">${stats.total_accounts}</span></div>
        <div class="settings-row"><label>Espacio utilizado</label><span style="color:var(--text)">${formatBytes(stats.total_size)}</span></div>
      </div>

      <div class="settings-section">
        <h3>📖 Ayuda — Configurar cuentas</h3>

        <details style="margin-bottom:.5rem">
          <summary style="cursor:pointer;font-weight:500;font-size:.85rem">📧 Gmail</summary>
          <div class="settings-help-content">
            <p>Gmail requiere una <strong>contraseña de aplicación</strong> si tienes verificación en dos pasos activada:</p>
            <ol>
              <li>Ve a <a href="https://myaccount.google.com/security" target="_blank" style="color:var(--accent)">Seguridad de Google</a></li>
              <li>Activa la <strong>Verificación en dos pasos</strong> si no la tienes</li>
              <li>Ve a <strong>Contraseñas de aplicaciones</strong> (busca en la barra de búsqueda)</li>
              <li>Selecciona "Correo" y "Otro", pon "MailSilo" como nombre</li>
              <li>Copia la contraseña de 16 caracteres que aparece</li>
              <li>En MailSilo, usa esa contraseña al añadir la cuenta</li>
            </ol>
            <p style="font-size:.78rem;color:var(--text-tertiary)">Servidor: <code>imap.gmail.com</code> · Puerto: <code>993</code> · SSL: ✅</p>
          </div>
        </details>

        <details style="margin-bottom:.5rem">
          <summary style="cursor:pointer;font-weight:500;font-size:.85rem">🍎 iCloud</summary>
          <div class="settings-help-content">
            <p>iCloud requiere una <strong>contraseña específica para aplicaciones</strong>:</p>
            <ol>
              <li>Ve a <a href="https://appleid.apple.com/account/manage" target="_blank" style="color:var(--accent)">Apple ID</a> e inicia sesión</li>
              <li>En la sección <strong>Seguridad</strong>, haz clic en "Generar contraseña específica"</li>
              <li>Pon "MailSilo" como nombre y haz clic en "Crear"</li>
              <li>Copia la contraseña que aparece</li>
              <li>En MailSilo, usa tu email de iCloud como usuario y esa contraseña</li>
            </ol>
            <p style="font-size:.78rem;color:var(--text-tertiary)">Servidor: <code>imap.mail.me.com</code> · Puerto: <code>993</code> · SSL: ✅</p>
          </div>
        </details>

        <details style="margin-bottom:.5rem">
          <summary style="cursor:pointer;font-weight:500;font-size:.85rem">🔵 Outlook / Hotmail</summary>
          <div class="settings-help-content">
            <p>Outlook y Hotmail requieren OAuth 2.0 para conectarse vía IMAP. Necesitas una <strong>cuenta Microsoft</strong> (personal, @outlook.com/@hotmail.com, o corporativa Microsoft 365) para registar la aplicación — es la que usas para iniciar sesión en <a href="https://portal.azure.com" target="_blank" style="color:var(--accent)">portal.azure.com</a>.</p>

            <h4 style="margin:.5rem 0 .25rem">1️⃣ Requisitos</h4>
            <ul style="list-style:disc;margin-left:1.2rem">
              <li>Una cuenta de Microsoft (no necesitas suscripción de pago para registrar apps)</li>
              <li>Saber la URL pública donde tienes instalado MailSilo (ej: <code>https://correo.tudominio.com</code>)</li>
              <li>Si usas Microsoft 365 / Exchange Online, necesitas que un administrador de tenant autorice los permisos (o que los usuarios acepten el consentimiento)</li>
            </ul>

            <h4 style="margin:.5rem 0 .25rem">2️⃣ Registrar la aplicación en Azure</h4>
            <ol>
              <li>Inicia sesión en <a href="https://portal.azure.com" target="_blank" style="color:var(--accent)">portal.azure.com</a> con tu cuenta Microsoft</li>
              <li>En el buscador superior escribe <strong>"App registrations"</strong> y selecciona esa opción</li>
              <li>Haz clic en <strong>+ New registration</strong></li>
              <li>Nombre: <code>MailSilo</code></li>
              <li>En <strong>Supported account types</strong> elige:
                <br><em>— "Accounts in any organizational directory (Any Microsoft 365 directory) and personal Microsoft accounts"</em>
                <br>Esto permite que cualquier cuenta Outlook/Hotmail/Exchange pueda conectarse</li>
              <li>En <strong>Redirect URI</strong>: selecciona <strong>Web</strong> y escribe:
                <br><code>https://TUDOMINIO:PUERTO/api/oauth/microsoft/callback</code>
                <br>Ejemplo: <code>https://correo.tudominio.com/api/oauth/microsoft/callback</code>
                <br>Si pruebas en local: <code>http://localhost:8765/api/oauth/microsoft/callback</code></li>
              <li>Haz clic en <strong>Register</strong></li>
            </ol>

            <h4 style="margin:.5rem 0 .25rem">3️⃣ Obtener el Client ID</h4>
            <p>Una vez registrada la app, en la página principal (<strong>Overview</strong>) verás:</p>
            <ul style="list-style:disc;margin-left:1.2rem">
              <li><strong>Application (client) ID</strong> — cópialo, es tu <code>client_id</code></li>
            </ul>

            <h4 style="margin:.5rem 0 .25rem">4️⃣ Crear un secreto de cliente</h4>
            <ol>
              <li>En el menú lateral izquierdo, ve a <strong>Certificates & secrets</strong></li>
              <li>En la pestaña <strong>Client secrets</strong>, haz clic en <strong>+ New client secret</strong></li>
              <li>Descripción: <code>MailSilo secret</code></li>
              <li>Expiración: elige la que prefieras (recomendado 24 meses, pon un recordatorio para renovarlo)</li>
              <li>Haz clic en <strong>Add</strong></li>
              <li><strong>IMPORTANTE:</strong> Copia el <strong>Value</strong> del secreto inmediatamente (no el ID). Después de salir de esta página no podrás volver a verlo</li>
            </ol>

            <h4 style="margin:.5rem 0 .25rem">5️⃣ Configurar permisos de API (IMAP)</h4>
            <ol>
              <li>En el menú lateral, ve a <strong>API permissions</strong></li>
              <li>Haz clic en <strong>+ Add a permission</strong></li>
              <li>Selecciona <strong>Microsoft Graph</strong> → <strong>Delegated permissions</strong></li>
              <li>En el buscador escribe <code>IMAP</code></li>
              <li>Marca el permiso: <strong><code>IMAP.AccessAsUser.All</code></strong></li>
              <li>Haz clic en <strong>Add permissions</strong></li>
              <li><strong>IMPORTANTE:</strong> Si tu organización requiere aprobación administrativa, verás un banner "Consent required". El administrador del tenant debe hacer clic en <strong>Grant admin consent for [tenant]</strong> y aceptar. Sin este paso los usuarios verán un error de "admin_consent_required" al intentar conectar.</li>
              <li>Si eres usuario particular (Outlook.com/Hotmail personal), cada usuario autorizará los permisos al conectar su cuenta; no necesitas consentimiento administrativo.</li>
            </ol>

            <h4 style="margin:.5rem 0 .25rem">6️⃣ Guardar en MailSilo</h4>
            <p>En Settings → <strong>🔵 Outlook / Hotmail — OAuth</strong> ingresa los datos:</p>
            <ul style="list-style:disc;margin-left:1.2rem">
              <li><strong>Client ID:</strong> el Application ID de Azure</li>
              <li><strong>Client Secret:</strong> el valor del secreto que creaste</li>
              <li><strong>Redirect URI:</strong> debe coincidir <strong>exactamente</strong> con el que registraste en Azure (incluyendo puerto)</li>
            </ul>
            <p>Haz clic en <strong>💾 Guardar</strong>. No necesitas reiniciar el servidor.</p>

            <h4 style="margin:.5rem 0 .25rem">7️⃣ Verificar que funciona</h4>
            <ol>
              <li>Ve a Cuentas → Añadir cuenta</li>
              <li>Selecciona <strong>🔵 Outlook / Hotmail</strong></li>
              <li>Ingresa un email de Outlook/Hotmail</li>
              <li>Haz clic en <strong>🔵 Conectar con Microsoft</strong></li>
              <li>Si ves la pantalla de inicio de sesión de Microsoft, la configuración es correcta</li>
            </ol>

            <h4 style="margin:.5rem 0 .25rem">📱 Para usuarios finales</h4>
            <p>Una vez que el administrador configuró Azure, cualquier usuario puede conectar su cuenta Outlook/Hotmail:</p>
            <ol>
              <li>Al añadir una cuenta, ingresa el email de Outlook/Hotmail</li>
              <li>Haz clic en <strong>🔵 Conectar con Microsoft</strong> — se abrirá una ventana de Microsoft</li>
              <li>Inicia sesión con tu cuenta Microsoft y acepta los permisos (IMAP acceso a tu correo)</li>
              <li>Vuelve a MailSilo, completa nombre, servidor, etc. y haz clic en <strong>Guardar</strong></li>
              <li>Sincroniza los correos con el botón 🔄</li>
            </ol>

            <p style="font-size:.78rem;color:var(--text-tertiary)">Servidor: <code>outlook.office365.com</code> · Puerto: <code>993</code> · SSL: ✅</p>

            <h4 style="margin:.5rem 0 .25rem">📁 Obtener carpetas después de conectar</h4>
            <ol>
              <li>Ve a <strong>Cuentas</strong> y haz clic en la cuenta que acabas de crear</li>
              <li>Haz clic en <strong>Editar</strong></li>
              <li>Haz clic en <strong>🔍 Probar conexión y obtener carpetas</strong></li>
              <li>Selecciona las carpetas que quieras sincronizar (INBOX, Enviados, etc.)</li>
              <li>Haz clic en <strong>Guardar</strong></li>
              <li>Ahora puedes sincronizar con el botón 🔄</li>
            </ol>
          </div>
        </details>

        <details style="margin-bottom:.5rem">
          <summary style="cursor:pointer;font-weight:500;font-size:.85rem">🌐 IMAP genérico</summary>
          <div class="settings-help-content">
            <p>Para cualquier proveedor de correo que soporte IMAP:</p>
            <ol>
              <li>Asegúrate de tener el servidor y puerto IMAP de tu proveedor</li>
              <li>Normalmente el puerto es <code>993</code> con SSL, o <code>143</code> sin SSL</li>
              <li>Si el servidor tiene autenticación de dos factores, busca "contraseña de aplicación" en la configuración de seguridad</li>
            </ol>
          </div>
        </details>

        <details style="margin-bottom:.5rem">
          <summary style="cursor:pointer;font-weight:500;font-size:.85rem">📤 Reenviar correos (SMTP)</summary>
          <div class="settings-help-content">
            <p>Puedes reenviar cualquier correo almacenado en MailSilo a un destinatario externo desde el botón <strong>📤 Reenviar</strong> en la vista de detalle del correo. Usa los campos de arriba para configurar el servidor SMTP.</p>

            <h4 style="margin:.5rem 0 .25rem">▶️ Pasos para configurar</h4>
            <ol style="font-size:.82rem;margin-left:1.2rem">
              <li>Completá <strong>Servidor</strong>, <strong>Puerto</strong>, <strong>Usuario</strong> y <strong>Contraseña</strong> según tu proveedor</li>
              <li>Marcá <strong>TLS</strong> si el puerto es <code>587</code> (lo más común)</li>
              <li>Hacé clic en <strong>💾 Guardar SMTP</strong></li>
              <li>Después de guardar, hacé clic en <strong>📤 Probar SMTP</strong> para verificar que las credenciales funcionan</li>
              <li>Si la prueba falla, revisá los datos o generá una <strong>contraseña de aplicación</strong> en la seguridad de tu proveedor</li>
            </ol>

            <h4 style="margin:.5rem 0 .25rem">Configuración por proveedor</h4>

            <p style="margin:.5rem 0 .25rem"><strong>📧 Gmail</strong></p>
            <ul style="list-style:disc;margin-left:1.2rem;font-size:.82rem">
              <li>Servidor: <code>smtp.gmail.com</code></li>
              <li>Puerto: <code>587</code> — TLS: ✅ marcado</li>
              <li>Usuario: tu email de Gmail completo (ej. <code>tucuenta@gmail.com</code>)</li>
              <li>Contraseña: <strong>no es tu contraseña normal</strong>. Necesitás una <strong>contraseña de aplicación</strong>:
                <ol style="margin-top:.15rem;margin-left:1.2rem;list-style:decimal">
                  <li>Andá a <a href="https://myaccount.google.com/security" target="_blank" style="color:var(--accent)">Seguridad de Google</a></li>
                  <li>Activá <strong>Verificación en dos pasos</strong> si no la tenés activada</li>
                  <li>Andá a <strong>"Contraseñas de aplicación"</strong> (buscá en la misma página de seguridad)</li>
                  <li>Generá una contraseña para "Correo" y copiala acá</li>
                </ol>
              </li>
            </ul>

            <p style="margin:.5rem 0 .25rem"><strong>🔵 Outlook / Hotmail / Microsoft 365</strong></p>
            <ul style="list-style:disc;margin-left:1.2rem;font-size:.82rem">
              <li>Servidor: <code>smtp.office365.com</code> (si no funciona, probá <code>smtp-mail.outlook.com</code>)</li>
              <li>Puerto: <code>587</code> — TLS: ✅ marcado</li>
              <li>Usuario: tu email completo (ej. <code>tucuenta@outlook.com</code> o <code>tucuenta@tudominio.com</code>)</li>
              <li>Contraseña: <strong>no es tu contraseña de OAuth</strong>. Necesitás una <strong>contraseña de aplicación</strong>:
                <ol style="margin-top:.15rem;margin-left:1.2rem;list-style:decimal">
                  <li>Andá a <a href="https://account.microsoft.com/security" target="_blank" style="color:var(--accent)">Seguridad de Microsoft</a></li>
                  <li>Iniciá sesión y andá a <strong>"Seguridad"</strong> → <strong>"Contraseñas de aplicación"</strong></li>
                  <li>Generá una y copiala acá</li>
                </ol>
              </li>
              <li>Nota: si tenés Microsoft 365 con autenticación moderna, puede que SMTP con contraseña ya no funcione. En ese caso usá un relay como SendGrid o el SMTP de tu dominio.</li>
            </ul>

            <p style="margin:.5rem 0 .25rem"><strong>🍎 iCloud</strong></p>
            <ul style="list-style:disc;margin-left:1.2rem;font-size:.82rem">
              <li>Servidor: <code>smtp.mail.me.com</code></li>
              <li>Puerto: <code>587</code> — TLS: ✅ marcado</li>
              <li>Usuario: tu email de iCloud (ej. <code>tucuenta@icloud.com</code>)</li>
              <li>Contraseña: la misma <strong>contraseña específica</strong> que generaste para IMAP en <a href="https://appleid.apple.com" target="_blank" style="color:var(--accent)">appleid.apple.com</a></li>
            </ul>

            <p style="margin:.5rem 0 .25rem"><strong>Y! Yahoo Mail</strong></p>
            <ul style="list-style:disc;margin-left:1.2rem;font-size:.82rem">
              <li>Servidor: <code>smtp.mail.yahoo.com</code></li>
              <li>Puerto: <code>587</code> — TLS: ✅ marcado</li>
              <li>Usuario: tu email de Yahoo completo</li>
              <li>Contraseña: la misma <strong>contraseña de aplicación</strong> que generaste para IMAP en <a href="https://login.yahoo.com/account/security" target="_blank" style="color:var(--accent)">Seguridad de Yahoo</a></li>
            </ul>

            <p style="margin:.5rem 0 .25rem"><strong>🌐 Cualquier otro proveedor</strong></p>
            <ul style="list-style:disc;margin-left:1.2rem;font-size:.82rem">
              <li>Usá los datos SMTP que te dé tu proveedor de correo o hosting</li>
              <li>Puerto <code>587</code> con TLS ✅ es lo más común</li>
              <li>Si usás puerto <code>465</code> (SSL directo), <strong>desactivá</strong> la opción TLS</li>
              <li>Si el servidor no requiere autenticación, poné cualquier usuario/contraseña (el sistema igual los va a pedir)</li>
              <li>Después de guardar, probá con el botón <strong>📤 Probar SMTP</strong></li>
            </ul>
          </div>
        </details>

        <details>
          <summary style="cursor:pointer;font-weight:500;font-size:.85rem">🔐 Sincronización automática</summary>
          <div class="settings-help-content">
            <p>Puedes programar la sincronización automática de cada cuenta:</p>
            <ol>
              <li>Ve a <strong>Cuentas</strong> y haz clic en la cuenta que quieras configurar</li>
              <li>Haz clic en <strong>Editar</strong></li>
              <li>En "Sincronización automática", elige la frecuencia (cada 6h, 12h, 24h, 7d, 30d, o desactivado)</li>
              <li>El servidor revisará periódicamente si hay correos nuevos</li>
            </ol>
          </div>
        </details>
      </div>

      <div class="settings-section">
        <h3>ℹ️ Acerca de</h3>
        <div class="settings-about">
          <strong>MailSilo v0.1.1</strong><br><br>
          <em>El archivador inteligente que libera espacio en tu bandeja de entrada.</em><br><br>
          MailSilo es una solución de código abierto diseñada para respaldar, organizar y proteger tus correos electrónicos de forma local y segura. Descarga tus mensajes y adjuntos pesados para liberar espacio en la nube y evitar pagar suscripciones de almacenamiento adicionales.<br><br>
          <strong>Desarrollado por:</strong><br>
          César Arias<br><br>
          © ${now.getFullYear()} Todos los derechos reservados.<br><br>
          <strong>Tecnologías utilizadas:</strong><br>
          • Backend: FastAPI (Python)<br>
          • Base de datos: PostgreSQL<br>
          • Frontend: JavaScript<br><br>
          <strong>Créditos y Reconocimientos:</strong><br>
          • Icono de la aplicación: Generado por IA a través de Google Media Processing Services y editado para el proyecto.<br><br>
          <strong>Contacto, Soporte y Licencia:</strong><br>
          • GitHub Oficial: <a href="https://github.com/cfarias5" target="_blank" style="color:var(--accent)">github.com/cfarias5</a><br>
          • Reportar un problema o sugerencia: <a href="https://github.com/cfarias5/mailsilo/issues" target="_blank" style="color:var(--accent)">github.com/cfarias5/mailsilo/issues</a><br><br>
          <a href="https://buymeacoffee.com/cfarias5" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me a Coffee" style="height:48px;border-radius:6px"></a>
        </div>
      </div>
  `;
}

function onThemeChange(value) {
  setTheme(value);
  updateThemeIndicator();
}

function updateThemeIndicator() {
  const saved = getSavedTheme();
  const currentTheme = saved === "auto" ? getAutoTheme() + " (auto)" : saved;
  const el = $("#currentThemeIndicator");
  if (el) el.textContent = currentTheme;
}

async function toggleAuth(enabled) {
  try {
    await api("/api/settings/auth", {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    });
    toast(enabled ? "🔒 Protección con contraseña activada" : "🔓 Protección desactivada — cualquiera puede acceder");
  } catch (e) {
    toast(`Error: ${e.message}`);
    const cb = $("#authToggle");
    if (cb) cb.checked = !enabled;
  }
}

async function testSmtp() {
  const msg = $("#smtpSaveMsg");
  msg.textContent = "Probando conexión...";
  try {
    const r = await api("/api/settings/smtp/test", { method: "POST" });
    msg.textContent = r.message || "✅ Conexión exitosa";
    setTimeout(() => msg.textContent = "", 5000);
  } catch (e) {
    msg.textContent = `❌ ${e.message}`;
  }
}

async function saveSmtp() {
  const server = $("#smtpServer").value.trim();
  const port = parseInt($("#smtpPort").value) || 587;
  const use_ssl = $("#smtpSsl").checked;
  const username = $("#smtpUser").value.trim();
  const password = $("#smtpPassword").value;
  const msg = $("#smtpSaveMsg");
  msg.textContent = "Guardando...";
  try {
    await api("/api/settings/smtp", {
      method: "PUT",
      body: JSON.stringify({ server, port, use_ssl, username, password }),
    });
    $("#smtpPassword").value = "";
    msg.textContent = "✅ Guardado";
    setTimeout(() => msg.textContent = "", 3000);
  } catch (e) {
    msg.textContent = `❌ ${e.message}`;
  }
}
