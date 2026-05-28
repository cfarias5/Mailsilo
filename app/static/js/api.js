const API = "";

function authHeaders() {
  return AUTH_TOKEN ? { "Authorization": "Bearer " + AUTH_TOKEN } : {};
}

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...authHeaders(), ...opts.headers };
  const res = await fetch(API + path, { ...opts, headers });
  if (res.status === 401) {
    AUTH_TOKEN = "";
    localStorage.removeItem("mailsilo_token");
    showLogin();
    throw new Error("Sesión expirada");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    const msg = Array.isArray(err.detail)
      ? err.detail.map(d => d.msg || d.message || d).join("; ")
      : err.detail || "API error";
    throw new Error(msg);
  }
  return res.json();
}
