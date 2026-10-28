async function showLogin() {
  showLoading(false);
  const status = await fetch(API + "/api/auth/status").then((r) => r.json());

  // If auth is explicitly disabled, skip login entirely
  if (status.auth_enabled === false) {
    $("#authContainer").innerHTML = "";
    $("#app").classList.add("show");
    return initApp();
  }

  if (!status.has_users) {
    showSetup();
    return;
  }
  if (AUTH_TOKEN) {
    try {
      const me = await api("/api/auth/me");
      if (me.authenticated) {
        $("#authContainer").innerHTML = "";
        $("#app").classList.add("show");
        return initApp();
      }
    } catch (e) {}
    AUTH_TOKEN = "";
    localStorage.removeItem("mailsilo_token");
  }
  renderLoginForm();
}

function renderLoginForm(msg) {
  const errDisplay = msg ? "block" : "none";
  const authErr = msg ? `<div class="auth-error" id="loginError" style="display:block">${esc(msg)}</div>` : `<div class="auth-error" id="loginError" style="display:none"></div>`;
  $("#authContainer").innerHTML = `
<div class="auth-page hero">
  <div class="hero-content">
    <h1 class="hero-brand">MAILSILO</h1>
    <span class="hero-badge">Self-Hosted • Private • Secure</span>
    <h2 class="hero-title">Own your inbox.<br><span>Archive everything.</span></h2>
    <p class="hero-description">
      MailSilo is a self-hosted email archive that lets you back up,
      organize and instantly search every message from your own server.
      Reduce cloud storage costs, keep complete control of your data,
      and access your emails whenever you need them.
    </p>
    <div class="hero-features">
      <span>✓ Unlimited archives</span>
      <span>✓ Instant search</span>
      <span>✓ 100% private</span>
      <span>✓ Self-hosted</span>
    </div>
    <div class="auth-card">
      <img src="/static/logo-dark.png" alt="MailSilo" style="height:50px;display:block;margin:0 auto 1.25rem">
      ${authErr}
      <div class="auth-field">
        <label for="loginUser">Username</label>
        <input type="text" id="loginUser" autocomplete="username" autofocus>
      </div>
      <div class="auth-field">
        <label for="loginPassword">Password</label>
        <input type="password" id="loginPassword" autocomplete="current-password">
      </div>
      <button class="auth-btn" data-action="login">Sign in</button>
      <div style="text-align:center;margin-top:.75rem">
        <a href="#" data-action="show-backup-reset" style="font-size:.8rem;color:var(--accent);text-decoration:none">Use backup code</a>
      </div>
    </div>
  </div>
</div>`;
  updateLogo();
}

function showSetup() {
  $("#authContainer").innerHTML = `
<div class="auth-page hero">
  <div class="hero-content">
    <h1 class="hero-brand">MAILSILO</h1>
    <span class="hero-badge">Self-Hosted • Private • Secure</span>
    <h2 class="hero-title">Own your inbox.<br><span>Archive everything.</span></h2>
    <p class="hero-description">
      MailSilo is a self-hosted email archive that lets you back up,
      organize and instantly search every message from your own server.
      Reduce cloud storage costs, keep complete control of your data,
      and access your emails whenever you need them.
    </p>
    <div class="hero-features">
      <span>✓ Unlimited archives</span>
      <span>✓ Instant search</span>
      <span>✓ 100% private</span>
      <span>✓ Self-hosted</span>
    </div>
    <div class="auth-card">
      <img src="/static/logo-dark.png" alt="MailSilo" style="height:50px;display:block;margin:0 auto 1.25rem">
      <div class="auth-error" id="setupError"></div>
      <div class="auth-field">
        <label for="setupUser">Username</label>
        <input type="text" id="setupUser" autocomplete="username" autofocus>
      </div>
      <div class="auth-field">
        <label for="setupPassword">Password</label>
        <input type="password" id="setupPassword" autocomplete="new-password">
      </div>
      <div class="auth-field">
        <label for="setupConfirm">Confirm password</label>
        <input type="password" id="setupConfirm" autocomplete="new-password">
      </div>
      <div class="hero-note">
        After creating your account, you will receive <strong style="color:var(--text-secondary);text-transform:uppercase">10 backup codes</strong> to recover your password in case you forget it. Save them in a safe place.
      </div>
      <button class="auth-btn" data-action="setup">Create account</button>
    </div>
  </div>`;
  updateLogo();
}

async function doSetup() {
  const username = $("#setupUser").value.trim();
  const pw = $("#setupPassword").value;
  const confirm = $("#setupConfirm").value;
  if (username.length < 2) {
    $("#setupError").textContent = "Username must be at least 2 characters";
    $("#setupError").style.display = "block";
    return;
  }
  if (pw.length < 8) {
    $("#setupError").textContent = "Password must be at least 8 characters";
    $("#setupError").style.display = "block";
    return;
  }
  if (!/[A-Z]/.test(pw) || !/[a-z]/.test(pw) || !/[0-9]/.test(pw)) {
    $("#setupError").textContent = "Password must include uppercase, lowercase and a number";
    $("#setupError").style.display = "block";
    return;
  }
  if (pw !== confirm) {
    $("#setupError").textContent = "Passwords do not match";
    $("#setupError").style.display = "block";
    return;
  }
  const btn = document.querySelector('#authContainer .auth-btn[data-action="setup"]');
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Generating backup codes…";
  try {
    const res = await fetch(API + "/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: pw }),
    });
    if (!res.ok) {
      const err = await res.json();
      btn.disabled = false;
      btn.textContent = origText;
      $("#setupError").textContent = err.detail || "Error creating account";
      $("#setupError").style.display = "block";
      return;
    }
    const data = await res.json();
    AUTH_TOKEN = data.token;
    localStorage.setItem("mailsilo_token", AUTH_TOKEN);
    if (data.backup_codes && data.backup_codes.length) {
      showBackupCodesSetup(data.backup_codes);
    } else {
      location.reload();
    }
  } catch (e) {
    btn.disabled = false;
    btn.textContent = origText;
    $("#setupError").textContent = "Connection error";
    $("#setupError").style.display = "block";
  }
}

function showBackupCodesSetup(codes) {
  const list = codes.map(c => `<li style="font-family:monospace;font-size:.82rem;letter-spacing:0.5px">${esc(c)}</li>`).join("");
  $("#authContainer").innerHTML = `
<div class="auth-page hero">
  <div class="hero-content">
    <h1 class="hero-brand">MAILSILO</h1>
    <span class="hero-badge">Self-Hosted • Private • Secure</span>
    <h2 class="hero-title">Backup codes<br><span>Save them now</span></h2>
    <p class="hero-description">
      These codes are your emergency access. Each one can be used only once
      to reset your password. Store them in a safe place — you won't see them again.
    </p>
    <div class="auth-card" style="max-width:440px;text-align:left">
      <img src="/static/logo-dark.png" alt="MailSilo" style="height:40px;display:block;margin:0 auto 1rem">
      <div style="background:rgba(255,193,7,.15);color:#fbbf24;padding:.6rem;border-radius:6px;font-size:.78rem;margin-bottom:.75rem;text-align:center">
        ⚠️ Save these codes. You will not see them again.
      </div>
      <ol style="margin:0;padding-left:1.5rem">${list}</ol>
      <button class="auth-btn" data-action="backup-codes-done" style="margin-top:.75rem">I saved my codes</button>
    </div>
  </div>
</div>`;
  updateLogo();
}


// =========================================================
// BACKUP CODE RESET FLOW
// =========================================================

function renderBackupCodeReset(msg) {
  const errDisplay = msg ? "block" : "none";
  const authErr = msg ? `<div class="auth-error" id="backupResetError" style="display:block">${esc(msg)}</div>` : `<div class="auth-error" id="backupResetError" style="display:none"></div>`;
  $("#authContainer").innerHTML = `
<div class="auth-page hero">
  <div class="hero-content">
    <h1 class="hero-brand">MAILSILO</h1>
    <span class="hero-badge">Self-Hosted • Private • Secure</span>
    <h2 class="hero-title">Reset password<br><span>Use a backup code</span></h2>
    <p class="hero-description">
      Enter your username, one of your saved backup codes, and choose a new password.
      The backup code will be invalidated after use.
    </p>
    <div class="auth-card">
      <img src="/static/logo-dark.png" alt="MailSilo" style="height:50px;display:block;margin:0 auto 1.25rem">
      ${authErr}
      <div class="auth-field">
        <label for="backupResetUser">Username</label>
        <input type="text" id="backupResetUser" autocomplete="username" autofocus>
      </div>
      <div class="auth-field">
        <label for="backupResetCode">Backup code</label>
        <input type="text" id="backupResetCode" autocomplete="off" placeholder="XXXX-XXXX-XXXX">
      </div>
      <div class="auth-field">
        <label for="backupResetPassword">New password</label>
        <input type="password" id="backupResetPassword" autocomplete="new-password">
      </div>
      <div class="auth-field">
        <label for="backupResetConfirm">Confirm new password</label>
        <input type="password" id="backupResetConfirm" autocomplete="new-password">
      </div>
      <button class="auth-btn" data-action="backup-reset-submit">Reset password</button>
      <div style="text-align:center;margin-top:.75rem">
        <a href="#" data-action="back-to-login" style="font-size:.8rem;color:var(--accent);text-decoration:none">Back to sign in</a>
      </div>
    </div>
  </div>
</div>`;
  updateLogo();
}

function doBackupCodeReset() {
  const username = $("#backupResetUser").value.trim();
  const code = $("#backupResetCode").value.trim();
  const pw = $("#backupResetPassword").value;
  const confirm = $("#backupResetConfirm").value;

  if (!username) {
    renderBackupCodeReset("Enter your username");
    return;
  }
  if (!code) {
    renderBackupCodeReset("Enter your backup code");
    return;
  }
  if (pw.length < 8) {
    renderBackupCodeReset("Password must be at least 8 characters");
    return;
  }
  if (!/[A-Z]/.test(pw) || !/[a-z]/.test(pw) || !/[0-9]/.test(pw)) {
    renderBackupCodeReset("Password must include uppercase, lowercase and a number");
    return;
  }
  if (pw !== confirm) {
    renderBackupCodeReset("Passwords do not match");
    return;
  }

  fetch(API + "/api/auth/reset-with-backup-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, code, new_password: pw }),
  })
    .then(r => r.json())
    .then(data => {
      if (data.detail) {
        renderBackupCodeReset(data.detail);
        return;
      }
      toast("Password reset successfully. Sign in with your new password.");
      renderLoginForm();
    })
    .catch(() => renderBackupCodeReset("Connection error"));
}


// =========================================================
// LOGIN
// =========================================================

async function doLogin() {
  const username = $("#loginUser").value.trim();
  const pw = $("#loginPassword").value;
  if (!username) {
    renderLoginForm("Enter your username");
    return;
  }
  try {
    const res = await fetch(API + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: pw }),
    });
    if (!res.ok) {
      const err = await res.json();
      renderLoginForm(err.detail || "Invalid username or password");
      return;
    }
    const data = await res.json();
    AUTH_TOKEN = data.token;
    localStorage.setItem("mailsilo_token", AUTH_TOKEN);
    location.reload();
  } catch (e) {
    renderLoginForm("Connection error");
  }
}
