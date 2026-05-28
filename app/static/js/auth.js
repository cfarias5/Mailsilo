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
  $("#authContainer").innerHTML = `<div class="auth-page">
    <div class="auth-card">
      <div class="logo-area">
        <img src="/static/logo-dark.png" alt="MailSilo">
        <p>Inicia sesión</p>
      </div>
      <div class="auth-error" id="loginError" style="display:${errDisplay}">${esc(msg)}</div>
      <div class="auth-field">
        <label for="loginUser">Usuario</label>
        <input type="text" id="loginUser" autocomplete="username" autofocus>
      </div>
      <div class="auth-field">
        <label for="loginPassword">Contraseña</label>
        <input type="password" id="loginPassword" autocomplete="current-password">
      </div>
      <button class="auth-btn" data-action="login">Entrar</button>
    </div>
  </div>`;
  updateLogo();
}

function showSetup() {
  $("#authContainer").innerHTML = `<div class="auth-page">
    <div class="auth-card">
      <div class="logo-area">
        <img src="/static/logo-dark.png" alt="MailSilo">
        <p>Crear administrador</p>
      </div>
      <div class="auth-error" id="setupError"></div>
      <div class="auth-field">
        <label for="setupUser">Usuario</label>
        <input type="text" id="setupUser" autocomplete="username" autofocus>
      </div>
      <div class="auth-field">
        <label for="setupPassword">Contraseña</label>
        <input type="password" id="setupPassword" autocomplete="new-password">
      </div>
      <div class="auth-field">
        <label for="setupConfirm">Confirmar contraseña</label>
        <input type="password" id="setupConfirm" autocomplete="new-password">
      </div>
      <button class="auth-btn" data-action="setup">Crear cuenta</button>
    </div>
  </div>`;
  updateLogo();
}

async function doSetup() {
  const username = $("#setupUser").value.trim();
  const pw = $("#setupPassword").value;
  const confirm = $("#setupConfirm").value;
  if (username.length < 2) {
    $("#setupError").textContent = "El usuario debe tener al menos 2 caracteres";
    $("#setupError").style.display = "block";
    return;
  }
  if (pw.length < 8) {
    $("#setupError").textContent = "La contraseña debe tener al menos 8 caracteres";
    $("#setupError").style.display = "block";
    return;
  }
  if (!/[A-Z]/.test(pw) || !/[a-z]/.test(pw) || !/[0-9]/.test(pw)) {
    $("#setupError").textContent = "La contraseña debe tener mayúscula, minúscula y número";
    $("#setupError").style.display = "block";
    return;
  }
  if (pw !== confirm) {
    $("#setupError").textContent = "Las contraseñas no coinciden";
    $("#setupError").style.display = "block";
    return;
  }
  try {
    const res = await fetch(API + "/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: pw }),
    });
    if (!res.ok) {
      const err = await res.json();
      $("#setupError").textContent = err.detail || "Error al crear cuenta";
      $("#setupError").style.display = "block";
      return;
    }
    const data = await res.json();
    AUTH_TOKEN = data.token;
    localStorage.setItem("mailsilo_token", AUTH_TOKEN);
    location.reload();
  } catch (e) {
    $("#setupError").textContent = "Error de conexión";
    $("#setupError").style.display = "block";
  }
}

async function doLogin() {
  const username = $("#loginUser").value.trim();
  const pw = $("#loginPassword").value;
  if (!username) {
    renderLoginForm("Ingresa tu usuario");
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
      renderLoginForm(err.detail || "Usuario o contraseña incorrectos");
      return;
    }
    const data = await res.json();
    AUTH_TOKEN = data.token;
    localStorage.setItem("mailsilo_token", AUTH_TOKEN);
    location.reload();
  } catch (e) {
    renderLoginForm("Error de conexión");
  }
}
