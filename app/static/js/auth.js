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
        <p>Sign in</p>
      </div>
      <div class="auth-error" id="loginError" style="display:${errDisplay}">${esc(msg)}</div>
      <div class="auth-field">
        <label for="loginUser">Username</label>
        <input type="text" id="loginUser" autocomplete="username" autofocus>
      </div>
      <div class="auth-field">
        <label for="loginPassword">Password</label>
        <input type="password" id="loginPassword" autocomplete="current-password">
      </div>
      <button class="auth-btn" data-action="login">Sign in</button>
    </div>
  </div>`;
  updateLogo();
}

function showSetup() {
  $("#authContainer").innerHTML = `<div class="auth-page">
    <div class="auth-card">
      <div class="logo-area">
        <img src="/static/logo-dark.png" alt="MailSilo">
        <p>Create admin</p>
      </div>
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
  try {
    const res = await fetch(API + "/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: pw }),
    });
    if (!res.ok) {
      const err = await res.json();
      $("#setupError").textContent = err.detail || "Error creating account";
      $("#setupError").style.display = "block";
      return;
    }
    const data = await res.json();
    AUTH_TOKEN = data.token;
    localStorage.setItem("mailsilo_token", AUTH_TOKEN);
    location.reload();
  } catch (e) {
    $("#setupError").textContent = "Connection error";
    $("#setupError").style.display = "block";
  }
}

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
