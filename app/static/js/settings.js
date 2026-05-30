async function renderSettings() {
  setSplitView(false);
  setListTitle("Settings", "");
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
    { value: "auto", label: "Automatic (light by day, dark at night)" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ].map(x => `<option value="${x.value}" ${saved === x.value ? "selected" : ""}>${x.label}</option>`).join("");

  const now = new Date();
  const currentTheme = getAutoTheme();
  const nextChange = currentTheme === "light" ? "19:00 (dark)" : "7:00 (light)";

  const authChecked = authEnabled ? "checked" : "";
  const pwPlaceholder = smtp.has_password ? "•••••••• (leave empty to keep)" : "";

  $("#listPanelBody").innerHTML = `
      <div class="page-header"><h2>⚙️ Settings</h2></div>

      <div class="settings-section">
        <h3>🎨 Appearance</h3>
        <div class="settings-row">
          <label>Theme</label>
          <select class="settings-select" id="themeSelect" onchange="onThemeChange(this.value)">${themeOpts}</select>
        </div>
        <div style="font-size:.78rem;color:var(--text-tertiary);padding:.3rem .75rem">
          ${saved === "auto" ? `Auto-switch at ${nextChange}` : "Fixed theme selected"}
        </div>
      </div>

      <div class="settings-section">
        <h3>🔒 Security</h3>
        <div class="settings-row">
          <label>Password protection</label>
          <label class="switch">
            <input type="checkbox" id="authToggle" ${authChecked} onchange="toggleAuth(this.checked)">
            <span class="switch-slider"></span>
          </label>
        </div>
        <div style="font-size:.78rem;color:var(--text-tertiary);padding:.3rem .75rem">
          ${authEnabled
            ? "Login required to access MailSilo"
            : "Anyone can access without a password"}
        </div>
      </div>

      <div class="settings-section">
        <h3>📤 Email forwarding (SMTP)</h3>
        <div class="settings-row"><label>Server</label><input class="settings-input" id="smtpServer" value="${esc(smtp.server)}" placeholder="smtp.example.com"></div>
        <div class="settings-row"><label>Port</label><input class="settings-input" id="smtpPort" type="number" value="${smtp.port}" placeholder="587" style="width:100px"></div>
        <div class="settings-row">
          <label>SSL/TLS</label>
          <label class="switch">
            <input type="checkbox" id="smtpSsl" ${smtp.use_ssl ? "checked" : ""}>
            <span class="switch-slider"></span>
          </label>
        </div>
        <div class="settings-row"><label>Username</label><input class="settings-input" id="smtpUser" value="${esc(smtp.username)}" placeholder="you@email.com"></div>
        <div class="settings-row"><label>Password</label><input class="settings-input" id="smtpPassword" type="password" placeholder="${esc(pwPlaceholder)}"></div>
        <div style="padding:.3rem .75rem;display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">
          <button class="btn-sm primary" onclick="saveSmtp()">💾 Save SMTP</button>
          <button class="btn-sm outline" onclick="testSmtp()">📤 Test SMTP</button>
          <span id="smtpSaveMsg" style="font-size:.78rem"></span>
        </div>
        <div style="font-size:.78rem;color:var(--text-tertiary);padding:.3rem .75rem">
          Used to forward emails from any account. The sender (From) can be any address you've downloaded.
        </div>
      </div>

      <div class="settings-section">
        <h3>📊 Database</h3>
        <div class="settings-row"><label>Stored emails</label><span style="color:var(--text)">${stats.total_emails}</span></div>
        <div class="settings-row"><label>Configured accounts</label><span style="color:var(--text)">${stats.total_accounts}</span></div>
        <div class="settings-row"><label>Used space</label><span style="color:var(--text)">${formatBytes(stats.total_size)}</span></div>
      </div>

      <div class="settings-section">
        <h3>📖 Help — Account setup</h3>

        <details style="margin-bottom:.5rem">
          <summary style="cursor:pointer;font-weight:500;font-size:.85rem">📧 Gmail</summary>
          <div class="settings-help-content">
            <p>Gmail requires an <strong>app password</strong> if you have two-step verification enabled:</p>
            <ol>
              <li>Go to <a href="https://myaccount.google.com/security" target="_blank" style="color:var(--accent)">Google Security</a></li>
              <li>Enable <strong>2-Step Verification</strong> if not already on</li>
              <li>Go to <strong>App passwords</strong> (search in the search bar)</li>
              <li>Select "Mail" and "Other", enter "MailSilo" as the name</li>
              <li>Copy the 16-character password that appears</li>
              <li>In MailSilo, use that password when adding the account</li>
            </ol>
            <p style="font-size:.78rem;color:var(--text-tertiary)">Server: <code>imap.gmail.com</code> · Port: <code>993</code> · SSL: ✅</p>
          </div>
        </details>

        <details style="margin-bottom:.5rem">
          <summary style="cursor:pointer;font-weight:500;font-size:.85rem">🍎 iCloud</summary>
          <div class="settings-help-content">
            <p>iCloud requires an <strong>app-specific password</strong>:</p>
            <ol>
              <li>Go to <a href="https://appleid.apple.com/account/manage" target="_blank" style="color:var(--accent)">Apple ID</a> and sign in</li>
              <li>In the <strong>Security</strong> section, click "Generate App-Specific Password"</li>
              <li>Enter "MailSilo" as the name and click "Create"</li>
              <li>Copy the password that appears</li>
              <li>In MailSilo, use your iCloud email as username and that password</li>
            </ol>
            <p style="font-size:.78rem;color:var(--text-tertiary)">Server: <code>imap.mail.me.com</code> · Port: <code>993</code> · SSL: ✅</p>
          </div>
        </details>

        <details style="margin-bottom:.5rem">
          <summary style="cursor:pointer;font-weight:500;font-size:.85rem">🔵 Outlook / Hotmail</summary>
          <div class="settings-help-content">
            <p>Outlook and Hotmail require OAuth 2.0 to connect via IMAP. You need a <strong>Microsoft account</strong> (personal, @outlook.com/@hotmail.com, or Microsoft 365 work/school) to register the app — this is the account you use to sign in to <a href="https://portal.azure.com" target="_blank" style="color:var(--accent)">portal.azure.com</a>.</p>

            <h4 style="margin:.5rem 0 .25rem">1️⃣ Prerequisites</h4>
            <ul style="list-style:disc;margin-left:1.2rem">
              <li>A Microsoft account (no paid subscription needed to register apps)</li>
              <li>Know the public URL where MailSilo is installed (e.g. <code>https://mail.yourdomain.com</code>)</li>
              <li>If using Microsoft 365 / Exchange Online, a tenant admin must grant consent (or users accept consent)</li>
            </ul>

            <h4 style="margin:.5rem 0 .25rem">2️⃣ Register the app in Azure</h4>
            <ol>
              <li>Sign in to <a href="https://portal.azure.com" target="_blank" style="color:var(--accent)">portal.azure.com</a> with your Microsoft account</li>
              <li>In the top search bar type <strong>"App registrations"</strong> and select it</li>
              <li>Click <strong>+ New registration</strong></li>
              <li>Name: <code>MailSilo</code></li>
              <li>Under <strong>Supported account types</strong> choose:
                <br><em>— "Accounts in any organizational directory (Any Microsoft 365 directory) and personal Microsoft accounts"</em>
                <br>This allows any Outlook/Hotmail/Exchange account to connect</li>
              <li>Under <strong>Redirect URI</strong>: select <strong>Web</strong> and enter:
                <br><code>https://YOURDOMAIN:PORT/api/oauth/microsoft/callback</code>
                <br>Example: <code>https://mail.yourdomain.com/api/oauth/microsoft/callback</code>
                <br>For local testing: <code>http://localhost:8765/api/oauth/microsoft/callback</code></li>
              <li>Click <strong>Register</strong></li>
            </ol>

            <h4 style="margin:.5rem 0 .25rem">3️⃣ Get the Client ID</h4>
            <p>Once registered, on the <strong>Overview</strong> page you'll see:</p>
            <ul style="list-style:disc;margin-left:1.2rem">
              <li><strong>Application (client) ID</strong> — copy this, it's your <code>client_id</code></li>
            </ul>

            <h4 style="margin:.5rem 0 .25rem">4️⃣ Create a client secret</h4>
            <ol>
              <li>In the left menu, go to <strong>Certificates & secrets</strong></li>
              <li>In the <strong>Client secrets</strong> tab, click <strong>+ New client secret</strong></li>
              <li>Description: <code>MailSilo secret</code></li>
              <li>Expiration: choose your preference (recommended 24 months, set a reminder to renew)</li>
              <li>Click <strong>Add</strong></li>
              <li><strong>IMPORTANT:</strong> Copy the <strong>Value</strong> immediately (not the ID). You won't be able to see it again after leaving this page</li>
            </ol>

            <h4 style="margin:.5rem 0 .25rem">5️⃣ Configure API permissions (IMAP)</h4>
            <ol>
              <li>In the left menu, go to <strong>API permissions</strong></li>
              <li>Click <strong>+ Add a permission</strong></li>
              <li>Select <strong>Microsoft Graph</strong> → <strong>Delegated permissions</strong></li>
              <li>In the search box type <code>IMAP</code></li>
              <li>Check the permission: <strong><code>IMAP.AccessAsUser.All</code></strong></li>
              <li>Click <strong>Add permissions</strong></li>
              <li><strong>IMPORTANT:</strong> If your organization requires admin approval, you'll see a "Consent required" banner. The tenant admin must click <strong>Grant admin consent for [tenant]</strong> and accept. Without this step, users will see an "admin_consent_required" error when trying to connect.</li>
              <li>If you're a personal user (Outlook.com/Hotmail personal), each user authorizes permissions when connecting their account; no admin consent needed.</li>
            </ol>

            <h4 style="margin:.5rem 0 .25rem">6️⃣ Save in MailSilo</h4>
            <p>Go to Settings → <strong>🔵 Outlook / Hotmail — OAuth</strong> and enter:</p>
            <ul style="list-style:disc;margin-left:1.2rem">
              <li><strong>Client ID:</strong> the Application ID from Azure</li>
              <li><strong>Client Secret:</strong> the secret value you created</li>
              <li><strong>Redirect URI:</strong> must match <strong>exactly</strong> what you registered in Azure (including port)</li>
            </ul>
            <p>Click <strong>💾 Save</strong>. No server restart needed.</p>

            <h4 style="margin:.5rem 0 .25rem">7️⃣ Verify it works</h4>
            <ol>
              <li>Go to Accounts → Add account</li>
              <li>Select <strong>🔵 Outlook / Hotmail</strong></li>
              <li>Enter an Outlook/Hotmail email</li>
              <li>Click <strong>🔵 Connect with Microsoft</strong></li>
              <li>If you see the Microsoft login screen, the configuration is correct</li>
            </ol>

            <h4 style="margin:.5rem 0 .25rem">📱 For end users</h4>
            <p>Once the admin has configured Azure, any user can connect their Outlook/Hotmail account:</p>
            <ol>
              <li>When adding an account, enter the Outlook/Hotmail email</li>
              <li>Click <strong>🔵 Connect with Microsoft</strong> — a Microsoft window will open</li>
              <li>Sign in with your Microsoft account and accept the permissions (IMAP access to your email)</li>
              <li>Return to MailSilo, fill in name, server, etc. and click <strong>Save</strong></li>
              <li>Sync emails with the 🔄 button</li>
            </ol>

            <p style="font-size:.78rem;color:var(--text-tertiary)">Servidor: <code>outlook.office365.com</code> · Puerto: <code>993</code> · SSL: ✅</p>

            <h4 style="margin:.5rem 0 .25rem">📁 Get folders after connecting</h4>
            <ol>
              <li>Go to <strong>Accounts</strong> and click the account you just created</li>
              <li>Click <strong>Edit</strong></li>
              <li>Click <strong>🔍 Test connection & get folders</strong></li>
              <li>Select the folders you want to sync (INBOX, Sent, etc.)</li>
              <li>Click <strong>Save</strong></li>
              <li>Now you can sync with the 🔄 button</li>
            </ol>
          </div>
        </details>

        <details style="margin-bottom:.5rem">
          <summary style="cursor:pointer;font-weight:500;font-size:.85rem">🌐 Generic IMAP</summary>
          <div class="settings-help-content">
            <p>For any email provider that supports IMAP:</p>
            <ol>
              <li>Make sure you have the IMAP server and port from your provider</li>
              <li>Usually the port is <code>993</code> with SSL, or <code>143</code> without SSL</li>
              <li>If the server has two-factor authentication, look for "app password" in the security settings</li>
            </ol>
          </div>
        </details>

        <details style="margin-bottom:.5rem">
          <summary style="cursor:pointer;font-weight:500;font-size:.85rem">📤 Forward emails (SMTP)</summary>
          <div class="settings-help-content">
            <p>You can forward any email stored in MailSilo to an external recipient from the <strong>📤 Forward</strong> button in the email detail view. Use the fields above to configure the SMTP server.</p>

            <h4 style="margin:.5rem 0 .25rem">▶️ Setup steps</h4>
            <ol style="font-size:.82rem;margin-left:1.2rem">
              <li>Fill in <strong>Server</strong>, <strong>Port</strong>, <strong>Username</strong> and <strong>Password</strong> according to your provider</li>
              <li>Check <strong>TLS</strong> if the port is <code>587</code> (most common)</li>
              <li>Click <strong>💾 Save SMTP</strong></li>
              <li>After saving, click <strong>📤 Test SMTP</strong> to verify the credentials work</li>
              <li>If the test fails, double-check the details or generate an <strong>app password</strong> in your provider's security settings</li>
            </ol>

            <h4 style="margin:.5rem 0 .25rem">Provider-specific settings</h4>

            <p style="margin:.5rem 0 .25rem"><strong>📧 Gmail</strong></p>
            <ul style="list-style:disc;margin-left:1.2rem;font-size:.82rem">
              <li>Server: <code>smtp.gmail.com</code></li>
              <li>Port: <code>587</code> — TLS: ✅ checked</li>
              <li>Username: your full Gmail address (e.g. <code>you@gmail.com</code>)</li>
              <li>Password: <strong>not your normal password</strong>. You need an <strong>app password</strong>:
                <ol style="margin-top:.15rem;margin-left:1.2rem;list-style:decimal">
                  <li>Go to <a href="https://myaccount.google.com/security" target="_blank" style="color:var(--accent)">Google Security</a></li>
                  <li>Enable <strong>2-Step Verification</strong> if not already on</li>
                  <li>Go to <strong>"App passwords"</strong> (search in the same security page)</li>
                  <li>Generate a password for "Mail" and copy it here</li>
                </ol>
              </li>
            </ul>

            <p style="margin:.5rem 0 .25rem"><strong>🔵 Outlook / Hotmail / Microsoft 365</strong></p>
            <ul style="list-style:disc;margin-left:1.2rem;font-size:.82rem">
              <li>Server: <code>smtp.office365.com</code> (if it doesn't work, try <code>smtp-mail.outlook.com</code>)</li>
              <li>Port: <code>587</code> — TLS: ✅ checked</li>
              <li>Username: your full email (e.g. <code>you@outlook.com</code> or <code>you@yourdomain.com</code>)</li>
              <li>Password: <strong>not your OAuth password</strong>. You need an <strong>app password</strong>:
                <ol style="margin-top:.15rem;margin-left:1.2rem;list-style:decimal">
                  <li>Go to <a href="https://account.microsoft.com/security" target="_blank" style="color:var(--accent)">Microsoft Security</a></li>
                  <li>Sign in and go to <strong>"Security"</strong> → <strong>"App passwords"</strong></li>
                  <li>Generate one and copy it here</li>
                </ol>
              </li>
              <li>Note: if you have Microsoft 365 with modern authentication, SMTP with password may no longer work. In that case, use a relay like SendGrid or your domain's SMTP.</li>
            </ul>

            <p style="margin:.5rem 0 .25rem"><strong>🍎 iCloud</strong></p>
            <ul style="list-style:disc;margin-left:1.2rem;font-size:.82rem">
              <li>Server: <code>smtp.mail.me.com</code></li>
              <li>Port: <code>587</code> — TLS: ✅ checked</li>
              <li>Username: your iCloud email (e.g. <code>you@icloud.com</code>)</li>
              <li>Password: the same <strong>app-specific password</strong> you generated for IMAP at <a href="https://appleid.apple.com" target="_blank" style="color:var(--accent)">appleid.apple.com</a></li>
            </ul>

            <p style="margin:.5rem 0 .25rem"><strong>Y! Yahoo Mail</strong></p>
            <ul style="list-style:disc;margin-left:1.2rem;font-size:.82rem">
              <li>Server: <code>smtp.mail.yahoo.com</code></li>
              <li>Port: <code>587</code> — TLS: ✅ checked</li>
              <li>Username: your full Yahoo email</li>
              <li>Password: the same <strong>app password</strong> you generated for IMAP at <a href="https://login.yahoo.com/account/security" target="_blank" style="color:var(--accent)">Yahoo Security</a></li>
            </ul>

            <p style="margin:.5rem 0 .25rem"><strong>🌐 Any other provider</strong></p>
            <ul style="list-style:disc;margin-left:1.2rem;font-size:.82rem">
              <li>Use the SMTP details your email or hosting provider gives you</li>
              <li>Port <code>587</code> with TLS ✅ is most common</li>
              <li>If using port <code>465</code> (direct SSL), <strong>uncheck</strong> the TLS option</li>
              <li>If the server doesn't require authentication, enter any username/password (the system will still ask)</li>
              <li>After saving, test with the <strong>📤 Test SMTP</strong> button</li>
            </ul>
          </div>
        </details>

        <details>
          <summary style="cursor:pointer;font-weight:500;font-size:.85rem">🔐 Auto-sync</summary>
          <div class="settings-help-content">
            <p>You can schedule automatic sync for each account:</p>
            <ol>
              <li>Go to <strong>Accounts</strong> and click the account you want to configure</li>
              <li>Click <strong>Edit</strong></li>
              <li>Under "Auto-sync", choose the frequency (every 6h, 12h, 24h, 7d, 30d, or off)</li>
              <li>The server will periodically check for new emails</li>
            </ol>
          </div>
        </details>
      </div>

      <div class="settings-section">
        <h3>ℹ️ About</h3>
        <div class="settings-about">
          <strong>MailSilo v0.1.1</strong><br><br>
          <em>The smart archiver that frees up space in your inbox.</em><br><br>
          MailSilo is an open-source solution designed to back up, organize, and protect your emails locally and securely. Download your messages and heavy attachments to free up cloud space and avoid paying for additional storage subscriptions.<br><br>
          <strong>Developed by:</strong><br>
          César Arias<br><br>
          © ${now.getFullYear()} All rights reserved.<br><br>
          <strong>Technologies used:</strong><br>
          • Backend: FastAPI (Python)<br>
          • Database: PostgreSQL<br>
          • Frontend: JavaScript<br><br>
          <strong>Credits and Acknowledgments:</strong><br>
          • App icon: Generated by AI via Google Media Processing Services and edited for the project.<br><br>
          <strong>Contact, Support and License:</strong><br>
          • Official GitHub: <a href="https://github.com/cfarias5" target="_blank" style="color:var(--accent)">github.com/cfarias5</a><br>
          • Report an issue or suggestion: <a href="https://github.com/cfarias5/mailsilo/issues" target="_blank" style="color:var(--accent)">github.com/cfarias5/mailsilo/issues</a><br><br>
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
    toast(enabled ? "🔒 Password protection enabled" : "🔓 Protection disabled — anyone can access");
  } catch (e) {
    toast(`Error: ${e.message}`);
    const cb = $("#authToggle");
    if (cb) cb.checked = !enabled;
  }
}

async function testSmtp() {
  const msg = $("#smtpSaveMsg");
  msg.textContent = "Testing connection...";
  try {
    const r = await api("/api/settings/smtp/test", { method: "POST" });
    msg.textContent = r.message || "✅ Connection successful";
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
  msg.textContent = "Saving...";
  try {
    await api("/api/settings/smtp", {
      method: "PUT",
      body: JSON.stringify({ server, port, use_ssl, username, password }),
    });
    $("#smtpPassword").value = "";
    msg.textContent = "✅ Saved";
    setTimeout(() => msg.textContent = "", 3000);
  } catch (e) {
    msg.textContent = `❌ ${e.message}`;
  }
}
