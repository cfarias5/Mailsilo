let selectedAccountIds = new Set();
let batchDeletePoller = null;
let accountsCache = [];

function stopBatchDeletePoller() {
  if (batchDeletePoller) { clearTimeout(batchDeletePoller); batchDeletePoller = null; }
}

let renderAccountsPromise = null;
let renderQueued = false;

async function renderAccountsSafe() {
  if (renderAccountsPromise) {
    renderQueued = true;
    return renderAccountsPromise;
  }

  renderAccountsPromise = (async () => {
    try {
      await renderAccounts();
    } finally {
      renderAccountsPromise = null;

      if (renderQueued) {
        renderQueued = false;
        renderAccountsSafe();
      }
    }
  })();

  return renderAccountsPromise;
}

function scheduleAccountsRender() {
  renderAccountsSafe();
}

async function renderAccounts() {
  stopBatchDeletePoller();

  accountsCache = await api("/api/accounts");
  const accounts = accountsCache;

  // Preserve selected IDs that still exist
  const existingIds = new Set(accounts.map(a => a.id));
  selectedAccountIds.forEach(id => {
    if (!existingIds.has(id)) {
      selectedAccountIds.delete(id);
    }
  });

  updateAccountSelectionToolbar();

  let html = `<div class="accounts-header">
    <h2>📋 Email Accounts</h2>
    <button class="btn-sm primary" data-action="add-account">+ Add</button>
  </div>`;

  if (accounts.length === 0) {
    html += `<div class="empty-state-card">
      <div class="icon">📬</div>
      <p>No accounts configured.</p>
      <p style="font-size:.8rem;margin-top:.3rem">Add an IMAP account to sync your emails.</p>
    </div>`;
  } else {
    html += `<div class="selection-toolbar" id="accountSelectionToolbar" style="display:none">
      <label class="select-all-label"><input type="checkbox" id="selectAllAccounts" onchange="toggleSelectAllAccounts(this.checked)"> <span id="accountSelectionCount">0 selected</span></label>
      <button class="btn-sm danger" data-action="delete-selected-accounts">🗑 Delete selected</button>
    </div>`;
    html += `<div class="accounts-list">`;
    for (const a of accounts) {
      const checked = selectedAccountIds.has(a.id) ? "checked" : "";
      const badge = a.enabled
        ? `<span class="badge badge-active">Active</span>`
        : `<span class="badge badge-inactive">Inactive</span>`;
      const lastFetch = a.last_fetch ? new Date(a.last_fetch).toLocaleString() : "Never";
      html += `<div class="account-card" data-action="show-account" data-account-id="${a.id}">
        <input type="checkbox" class="account-checkbox" data-account-id="${a.id}" ${checked} onclick="event.stopPropagation()" onchange="toggleSelectAccount(${a.id}, this.checked)">
        <div class="account-card-top">
          <div>
            <div class="account-card-name">${esc(a.name)}</div>
            <div class="account-card-email">${esc(a.email)}</div>
          </div>
          <div class="account-card-badges">
            <span class="badge badge-count">${a.email_count}</span>
            ${badge}
          </div>
        </div>
        <div class="account-card-details">
          <span>🖥 ${esc(a.imap_server)}:${a.imap_port}</span>
          <span>📁 ${esc(a.folders.join(", "))}</span>
          <span>🔄 ${lastFetch}</span>
        </div>
        <div class="account-card-actions">
          ${a.is_imported ? "" : `<button class="btn-sm" data-action="fetch" data-account-id="${a.id}">🔄 Sync</button>`}
          <button class="btn-sm" data-action="export-account-mbox" data-account-id="${a.id}" data-account-email="${esc(a.email)}">📦 Export MBOX</button>
          <button class="btn-sm" data-action="edit-account" data-account-id="${a.id}">✏️ Edit</button>
          <button class="btn-sm danger" data-action="delete-account" data-account-id="${a.id}">🗑 Delete</button>
        </div>
        <div class="fetch-status-text" id="fetch-status-${a.id}"></div>
      </div>`;
    }
    html += `</div>`;
  }
  $("#listPanelBody").innerHTML = html;
  loadSidebarAccounts();
  // Single batch call for all statuses
  (async () => {
    try {
      const statuses = await api("/api/accounts/fetch-statuses");

      let runningFound = false;
      for (const a of accounts) {
        const s = statuses[a.id.toString()];
        if (!s) continue;
        updateFetchStatusDivFromStatus(a.id, s);
        if (s.status === "running") {
          runningFound = true;
          if (s.progress) {
            updateSidebarFetchProgress(a.id, s.progress);
            updateDetailFetchProgress(a.id, s.progress);
          }
          if (!fetchPollers[a.id]) {
            pollFetchStatus(a.id);
          }
        }
      }
    } catch (e) {}
  })();
}

async function showAccountDetail(id) {
  const accounts = await api("/api/accounts");
  const a = accounts.find(x => x.id === id);
  if (!a) return;

  setSplitView(true);
  setListTitle("Account", esc(a.email));
  $("#detailEmpty").style.display = "none";
  $("#detailContent").style.display = "block";

  const lastFetch = a.last_fetch ? new Date(a.last_fetch).toLocaleString() : "Never";
  const badge = a.enabled
    ? `<span class="badge badge-active">Active</span>`
    : `<span class="badge badge-inactive">Inactive</span>`;

  let folders = Array.isArray(a.folders) ? a.folders.join(", ") : a.folders;

  $("#detailContent").innerHTML = `
    <div class="account-detail-header">
      <div class="account-detail-avatar">${esc(a.name.charAt(0).toUpperCase())}</div>
      <div>
        <h2>${esc(a.name)}</h2>
        <p>${esc(a.email)}</p>
      </div>
    </div>

      <div class="detail-section">
        <div class="detail-section-title">Status</div>
        <div class="detail-info-grid">
          <div><span class="detail-label">Status</span><span>${badge}</span></div>
          <div><span class="detail-label">Emails</span><span>${a.email_count}</span></div>
          ${a.is_imported
            ? `<div style="grid-column:1/-1;color:var(--text-tertiary);font-size:.85rem;padding-top:.25rem">📥 Imported account — no IMAP connection</div>`
            : `<div><span class="detail-label">Last fetch</span><span>${lastFetch}</span></div>
               <div><span class="detail-label">Auto-sync</span><span>${syncIntervalLabel(a.sync_interval)}</span></div>`}
        </div>
      </div>

      <div class="detail-section" id="detail-fetch-section-${a.id}" style="display:none">
        <div class="detail-section-title">⏳ Sync in progress</div>
        <div class="import-progress-bar" style="margin:.5rem 0">
          <div id="detail-fetch-bar-${a.id}" class="import-progress-bar-fill" style="width:0%"></div>
        </div>
        <div class="import-progress-status" id="detail-fetch-status-${a.id}" style="font-size:.85rem">Starting...</div>
        <div class="import-progress-bar-group" id="detail-fetch-year-group-${a.id}" style="display:none;margin:.25rem 0 0 0">
          <div class="detail-section-title" style="font-size:.7rem;margin:0 0 .15rem 0">By year</div>
          <div class="import-progress-bar" style="height:.5rem">
            <div id="detail-fetch-year-bar-${a.id}" class="import-progress-bar-fill" style="width:0%"></div>
          </div>
          <div class="import-progress-status" id="detail-fetch-year-status-${a.id}" style="font-size:.7rem"></div>
        </div>
        <div class="import-progress-status" id="detail-fetch-folder-${a.id}" style="font-size:.78rem;color:var(--text-tertiary)"></div>
      </div>

    <div class="detail-section">
      <div class="detail-section-title">Server</div>
      <div class="detail-info-grid">
        <div><span class="detail-label">IMAP Server</span><span>${esc(a.imap_server)}</span></div>
        <div><span class="detail-label">Port</span><span>${a.imap_port}</span></div>
        <div><span class="detail-label">SSL</span><span>${a.imap_use_ssl ? "✅ Yes" : "❌ No"}</span></div>
        <div><span class="detail-label">Username</span><span>${esc(a.username)}</span></div>
        ${a.oauth_provider ? `<div><span class="detail-label">Auth</span><span>🔵 OAuth (${esc(a.oauth_provider)})</span></div>` : ""}
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">Folders</div>
      <div class="detail-info-grid" style="grid-template-columns:repeat(auto-fill,minmax(120px,1fr))">
        ${(Array.isArray(a.folders) ? a.folders : ["INBOX"]).map(f =>
          `<div class="folder-chip" data-action="show-folder" data-account-id="${a.id}" data-account-email="${esc(a.email)}" data-folder-name="${esc(f)}">
            📁 ${esc(f)}
          </div>`
        ).join("")}
      </div>
    </div>

    <div class="detail-actions">
      <button class="btn-sm primary" data-action="fetch" data-account-id="${a.id}">🔄 Sync now</button>
      <button class="btn-sm" data-action="export-account-mbox" data-account-id="${a.id}" data-account-email="${esc(a.email)}">📦 Export MBOX</button>
      <button class="btn-sm" data-action="edit-account" data-account-id="${a.id}">✏️ Edit account</button>
      <button class="btn-sm danger" data-action="delete-account" data-account-id="${a.id}">🗑 Delete account</button>
    </div>

    <div class="fetch-status-text" id="fetch-status-${a.id}" style="margin-top:.75rem"></div>
  `;
  updateFetchStatusDiv(a.id);
}

const SYNC_INTERVALS = [
  { value: "", label: "Don't schedule" },
  { value: "6h", label: "Every 6 hours" },
  { value: "12h", label: "Every 12 hours" },
  { value: "1d", label: "Every 24 hours" },
  { value: "7d", label: "Every 7 days" },
  { value: "30d", label: "Every 30 days" },
];

function syncIntervalLabel(val) {
  const found = SYNC_INTERVALS.find(x => x.value === val);
  return found ? found.label : "Don't schedule";
}

function nextSyncTime(interval, lastFetch) {
  if (!interval) return null;
  const unit = interval.slice(-1);
  const num = parseInt(interval);
  if (!num || !lastFetch) return null;
  const d = new Date(lastFetch);
  if (unit === "h") d.setHours(d.getHours() + num);
  else if (unit === "d") d.setDate(d.getDate() + num);
  else return null;
  return d;
}

const PROVIDERS = [
  {
    id: "outlook",
    name: "Outlook / Hotmail",
    icon: "/static/icons/outlook.webp",
    server: "outlook.office365.com",
    port: 993,
    ssl: true,
    auth: "oauth",
    desc: "Microsoft OAuth 2.0 authentication",
  },
  {
    id: "gmail",
    name: "Gmail",
    icon: "/static/icons/gmail.webp",
    server: "imap.gmail.com",
    port: 993,
    ssl: true,
    auth: "password",
    desc: "Requires app password",
  },
  {
    id: "yahoo",
    name: "Yahoo Mail",
    icon: "/static/icons/yahoo.webp",
    server: "imap.mail.yahoo.com",
    port: 993,
    ssl: true,
    auth: "password",
    desc: "Requires app password",
  },
  {
    id: "icloud",
    name: "iCloud",
    icon: "/static/icons/icloud.png",
    server: "imap.mail.me.com",
    port: 993,
    ssl: true,
    auth: "password",
    desc: "Requires specific password",
  },
  {
    id: "other",
    name: "Other / Generic IMAP",
    icon: "/static/icons/imap.png",
    server: "",
    port: 993,
    ssl: true,
    auth: "password",
    desc: "Manual configuration",
  },
];

function showProviderSelection() {
  const cards = PROVIDERS.map(p => `
    <div class="provider-card" data-provider="${p.id}" onclick="showAccountForm('${p.id}')">
      <div class="provider-icon"><img src="${p.icon}" alt="${p.name}"></div>
      <div class="provider-name">${p.name}</div>
      <div class="provider-desc">${p.desc}</div>
    </div>
  `).join("");

  openModal(`<h3 style="margin-bottom:16px;text-align:center">📬 Add email account</h3>
    <p style="text-align:center;color:var(--text-secondary);font-size:.85rem;margin-bottom:1rem">What is your email provider?</p>
    <div class="provider-grid">${cards}</div>
    <div class="form-actions" style="margin-top:1.5rem">
      <button class="outline" data-action="close-modal">Cancel</button>
    </div>`, { closable: false });
}

async function showEditAccount(id) {
  let acct = { name: "", email: "", imap_server: "", imap_port: 993, imap_use_ssl: true, username: "", password: "", folders: ["INBOX"], sync_interval: "" };
  const accounts = await api("/api/accounts");
  const found = accounts.find((a) => a.id === id);
  if (found) acct = { ...found, password: "" };

  const isOAuth = acct.oauth_provider === "microsoft";
  const intervalOpts = SYNC_INTERVALS.map(x =>
    `<option value="${x.value}" ${acct.sync_interval === x.value ? "selected" : ""}>${x.label}</option>`
  ).join("");

  const passwordHtml = isOAuth
    ? `<div class="form-group" style="border-top:1px solid var(--border);padding-top:.5rem">
        <div style="display:flex;align-items:center;gap:.5rem;font-size:.85rem">
          <span style="font-size:1.2rem">🔵</span>
          <span>OAuth (Microsoft) Authentication</span>
          <span style="color:var(--success);font-size:.8rem">✅ Connected</span>
        </div>
        <input type="hidden" name="password" value="">
       </div>`
    : `<div class="form-group"><label>Password (leave empty = no change)</label><input name="password" type="password" value=""></div>`;

  const testBtnAttrs = id
    ? `data-action="test-connection" data-account-id="${id}"`
    : `data-action="test-connection"`;

  const folderSection = acct.is_imported
    ? `<div class="form-group">
        <p style="color:var(--text-tertiary);font-size:.85rem;padding:.25rem 0">📥 Imported account — no IMAP connection available</p>
        <input type="hidden" name="folders" id="foldersInput" value="${esc(acct.folders.join(", "))}">
      </div>`
    : `<div class="form-group">
        <label>Folders to sync</label>
        <div class="folder-checkboxes" id="folderList">
          <p style="color:var(--text-tertiary);font-size:.85rem">${isOAuth ? "Connect to server to view folders" : "Connect to server to view folders"}</p>
        </div>
        <button type="button" class="outline" style="margin-top:6px" ${testBtnAttrs}>🔍 Test connection & get folders</button>
        <input type="hidden" name="folders" id="foldersInput" value="${esc(acct.folders.join(", "))}">
      </div>`;

  const syncSection = acct.is_imported
    ? `<div class="form-group"><label>Auto-sync</label>
        <p style="color:var(--text-tertiary);font-size:.85rem;padding:.25rem 0">Not available for imported accounts</p>
        <input type="hidden" name="sync_interval" value="">
      </div>`
    : `<div class="form-group"><label>Auto-sync</label>
        <select name="sync_interval">${intervalOpts}</select>
      </div>`;

  openModal(`<h3 style="margin-bottom:16px">✏️ Edit account — ${esc(acct.email)}</h3>
    <form id="accountForm">
      <div class="form-group"><label>Name</label><input name="name" value="${esc(acct.name)}" required></div>
      <div class="form-group"><label>Email</label><input name="email" type="email" value="${esc(acct.email)}" required></div>
      <div class="form-group"><label>IMAP Server</label><input name="imap_server" value="${esc(acct.imap_server)}" required></div>
      <div class="form-group"><label>Port</label><input name="imap_port" type="number" value="${acct.imap_port}"></div>
      <div class="form-group"><label><input type="checkbox" name="imap_use_ssl" ${acct.imap_use_ssl ? "checked" : ""}> Use SSL</label></div>
      <div class="form-group"><label>Username (leave empty = email)</label><input name="username" value="${esc(acct.username)}"></div>
      ${passwordHtml}
      ${syncSection}
      ${folderSection}
      <div class="form-actions">
        <button type="submit" class="primary" data-action="save-account" data-account-id="${id}">Save changes</button>
        <button class="outline" type="button" data-action="close-modal">Cancel</button>
      </div>
    </form>`, { closable: false });
  if (id) renderFolderCheckboxes(acct.folders);
}

async function showAccountForm(providerId, id = null) {
  const prov = PROVIDERS.find(p => p.id === providerId);

  if (providerId === "outlook") {
    await showOutlookForm(prov);
    return;
  }

  let acct = {
    name: "", email: "",
    imap_server: prov.server, imap_port: prov.port,
    imap_use_ssl: prov.ssl,
    username: "", password: "",
    folders: ["INBOX"], sync_interval: "",
  };
  if (id) {
    const accounts = await api("/api/accounts");
    const found = accounts.find((a) => a.id === id);
    if (found) acct = { ...found, password: "" };
  }

  const title = id ? "Edit account" : `Add account ${prov.icon} ${prov.name}`;
  const intervalOpts = SYNC_INTERVALS.map(x =>
    `<option value="${x.value}" ${acct.sync_interval === x.value ? "selected" : ""}>${x.label}</option>`
  ).join("");

  openModal(`<h3 style="margin-bottom:16px">${title}</h3>
    <form id="accountForm">
      <div class="form-group"><label>Name</label><input name="name" value="${esc(acct.name)}" required></div>
      <div class="form-group"><label>Email</label><input name="email" type="email" value="${esc(acct.email)}" ${id ? "readonly" : ""} required></div>
      <div class="form-group"><label>IMAP Server</label><input name="imap_server" value="${esc(acct.imap_server)}" required></div>
      <div class="form-group"><label>Port</label><input name="imap_port" type="number" value="${acct.imap_port}"></div>
      <div class="form-group"><label><input type="checkbox" name="imap_use_ssl" ${acct.imap_use_ssl ? "checked" : ""}> Use SSL</label></div>
      <div class="form-group"><label>Username (leave empty = email)</label><input name="username" value="${esc(acct.username)}"></div>
      <div class="form-group"><label>Password</label><input name="password" type="password" value="" required></div>
      <div class="form-group"><label>Auto-sync</label>
        <select name="sync_interval">${intervalOpts}</select>
      </div>
      <div class="form-group">
        <label>Folders to sync</label>
        <div class="folder-checkboxes" id="folderList">
          <p style="color:var(--text-tertiary);font-size:.85rem;margin-bottom:.5rem">📌 ${prov.id === "gmail" ? "Gmail requires an <strong>app password</strong>. Enable 2-step verification and generate one at myaccount.google.com/security" : prov.id === "yahoo" ? "Yahoo requires an <strong>app password</strong> from Yahoo Account Security" : prov.id === "icloud" ? "iCloud requires a <strong>specific password</strong> from appleid.apple.com" : "Connect to server to view folders"}</p>
        </div>
        <button type="button" class="outline" style="margin-top:6px" data-action="test-connection">🔍 Test connection & get folders</button>
        <input type="hidden" name="folders" id="foldersInput" value="${esc(acct.folders.join(", "))}">
      </div>
      <div class="form-actions">
        <button type="submit" class="primary" data-action="save-account" data-account-id="${id || 0}">Save</button>
        <button class="outline" type="button" onclick="showProviderSelection()">⬅ Back</button>
      </div>
    </form>`, { closable: false });
}

async function showOutlookForm(prov) {
  let azure = { client_id: "", client_secret: "", redirect_uri: "" };
  try { azure = await api("/api/settings/oauth/microsoft"); } catch (e) {}

  openModal(`<h3 style="margin-bottom:16px;text-align:center">🔵 Add Outlook / Hotmail account</h3>
    <p style="text-align:center;color:var(--text-secondary);font-size:.85rem;margin-bottom:1rem">Connect with Microsoft OAuth — no password needed</p>
    <form id="accountForm">
      <div class="form-group"><label>Name</label><input name="name" value="" required></div>
      <div class="form-group"><label>Outlook / Hotmail Email</label><input name="email" id="outlookEmail" type="email" value="" required></div>
      <input type="hidden" name="imap_server" value="${prov.server}">
      <input type="hidden" name="imap_port" value="${prov.port}">
      <input type="hidden" name="imap_use_ssl" value="1">
      <input type="hidden" name="username" value="">
      <input type="hidden" name="password" value="">
      <input type="hidden" name="folders" value="INBOX">
      <input type="hidden" name="sync_interval" value="">

      <details style="margin:.5rem 0;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:.5rem .75rem">
        <summary style="cursor:pointer;font-weight:500;font-size:.82rem;color:var(--text-secondary)">🔧 Azure AD Configuration (required for OAuth)</summary>
        <div style="margin-top:.5rem">
          <div class="form-group" style="margin-bottom:.5rem">
            <label>Client ID</label>
            <input id="azureClientId" value="${esc(azure.client_id)}" placeholder="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" style="font-family:monospace;font-size:.8rem" required>
          </div>
          <div class="form-group" style="margin-bottom:.5rem">
            <label>Client Secret</label>
            <input id="azureClientSecret" type="password" value="${esc(azure.client_secret)}" placeholder="v8r~..." style="font-family:monospace;font-size:.8rem" required>
          </div>
          <div class="form-group" style="margin-bottom:.5rem">
            <label>Redirect URI</label>
            <input id="azureRedirectUri" value="${esc(azure.redirect_uri)}" placeholder="https://correo.tudominio.com/api/oauth/microsoft/callback" style="font-family:monospace;font-size:.8rem" required>
            <div style="font-size:.72rem;color:var(--text-tertiary);margin-top:.2rem">Must match the redirect URI registered in Azure exactly</div>
          </div>
        </div>
      </details>

      <div id="outlookOAuthSection" style="text-align:center;margin-top:.5rem">
        <button type="button" class="btn-lg primary" id="outlookOAuthBtn" onclick="startOutlookOAuth()">
          🔵 Connect with Microsoft
        </button>
        <div id="outlookOAuthStatus" style="margin-top:.5rem;font-size:.85rem;color:var(--text-tertiary)"></div>
      </div>
      <div id="outlookConnectedSection" style="display:none;text-align:center">
        <div style="color:var(--success);font-size:2rem;margin-bottom:.25rem">✅</div>
        <p style="color:var(--success);font-weight:500">Microsoft account connected</p>
      </div>
      <div class="form-actions" style="margin-top:1.5rem">
        <button type="submit" class="primary" data-action="save-account" data-account-id="0" id="outlookSaveBtn" disabled>Save account</button>
        <button class="outline" type="button" onclick="showProviderSelection()">⬅ Back</button>
      </div>
    </form>`, { closable: false });
}

let _outlookEmail = null;

async function startOutlookOAuth() {
  const email = $("#outlookEmail")?.value?.trim();
  if (!email) {
    toast("Enter your Outlook / Hotmail email first");
    return;
  }

  const clientId = $("#azureClientId")?.value?.trim();
  const clientSecret = $("#azureClientSecret")?.value?.trim();
  const redirectUri = $("#azureRedirectUri")?.value?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    toast("Complete the Azure AD data (Client ID, Secret and Redirect URI)");
    return;
  }

  // Save Azure credentials to DB so the OAuth flow can use them
  try {
    await api("/api/settings/oauth/microsoft", {
      method: "PUT",
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri }),
    });
  } catch (e) {
    toast("Error saving Azure configuration: " + e.message);
    return;
  }

  _outlookEmail = email;
  const url = `${API}/api/oauth/microsoft/login?email=${encodeURIComponent(email)}&token=${encodeURIComponent(AUTH_TOKEN)}`;
  const popup = window.open(url, "microsoft-oauth", "width=600,height=700,left=200,top=100");

  const statusEl = $("#outlookOAuthStatus");
  statusEl.textContent = "⏳ Opening Microsoft...";

  const pollInterval = setInterval(async () => {
    try {
      const r = await api(`/api/oauth/microsoft/tokens?email=${encodeURIComponent(email)}`);
      if (r.connected) {
        clearInterval(pollInterval);
        if (statusEl) statusEl.innerHTML = `<span style="color:var(--success)">✅ Connected</span>`;
        $("#outlookOAuthSection").style.display = "none";
        $("#outlookConnectedSection").style.display = "block";
        $("#outlookSaveBtn").disabled = false;
        toast("✅ Microsoft account connected");
        if (popup && !popup.closed) popup.close();
      }
    } catch (e) {}
  }, 1500);

  const closeCheck = setInterval(() => {
    if (!popup || popup.closed) {
      clearInterval(closeCheck);
      setTimeout(() => clearInterval(pollInterval), 10000);
      const st = $("#outlookOAuthStatus");
      if (st && st.textContent.includes("⏳")) {
        st.innerHTML = `<span style="color:var(--text-tertiary)">⏹ Cancelled — click Connect to try again</span>`;
      }
    }
  }, 2000);
}

function renderFolderCheckboxes(selected) {
  const container = $("#folderList");
  const sel = new Set(selected.map((f) => f.toLowerCase()));
  const checkboxes = $$("input[data-folder]", container);
  if (checkboxes.length === 0) return;
  checkboxes.forEach((cb) => {
    cb.checked = sel.has(cb.dataset.folder.toLowerCase());
  });
  updateFoldersInput();
}

function updateFoldersInput() {
  const checked = $$("#folderList input[data-folder]:checked");
  const names = checked.map((cb) => cb.dataset.folder);
  $("#foldersInput").value = names.join(", ");
}

async function testConnection() {
  const form = $("#accountForm");
  const btn = form.querySelector("[data-action='test-connection']");
  const accountId = btn?.dataset?.accountId;

  btn.disabled = true;
  btn.textContent = "Connecting...";
  $("#folderList").innerHTML = `<p style="color:var(--text-tertiary)">Connecting...</p>`;

  try {
    let result;
    if (accountId) {
      // Editing — use saved credentials from the DB
      const res = await fetch(API + `/api/accounts/${accountId}/fetch-folders`, {
        method: "POST",
        headers: { ...authHeaders() },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Error");
      }
      result = await res.json();
    } else {
      // New account — use credentials from the form
      const fd = new FormData(form);
      const data = {
        imap_server: fd.get("imap_server"),
        imap_port: parseInt(fd.get("imap_port")) || 993,
        imap_use_ssl: fd.has("imap_use_ssl"),
        username: fd.get("username") || fd.get("email"),
        password: fd.get("password"),
      };
      if (!data.imap_server || !data.password) {
        toast("Complete server and password first");
        btn.disabled = false;
        btn.textContent = "🔍 Test connection & get folders";
        return;
      }
      const res = await fetch(API + "/api/accounts/test-folders", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Error");
      }
      result = await res.json();
    }

    const selected = ($("#foldersInput").value || "INBOX").split(",").map((s) => s.trim().toLowerCase());
    let html = result.folders.map((f) => {
      const checked = selected.includes(f.toLowerCase()) ? "checked" : "";
      return `<label style="display:flex;align-items:center;gap:.4rem;padding:.15rem 0;font-size:.875rem;cursor:pointer">
        <input type="checkbox" data-folder="${esc(f)}" ${checked} data-action="update-folders-input">
        ${esc(f)}
      </label>`;
    }).join("");
    if (result.folders.length === 0) html = `<p style="color:var(--text-tertiary)">No folders found</p>`;
    $("#folderList").innerHTML = html;
    updateFoldersInput();
    toast(`✅ ${result.folders.length} folders found`);
  } catch (e) {
    $("#folderList").innerHTML = `<p style="color:#ef4444">Error: ${e.message}</p>`;
    toast(`Error: ${e.message}`);
  }
  btn.disabled = false;
  btn.textContent = "🔍 Test connection & get folders";
}

async function saveAccount(e, id) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const data = Object.fromEntries(fd.entries());
  if (data.imap_port) data.imap_port = parseInt(data.imap_port);
  data.imap_use_ssl = fd.has("imap_use_ssl") || fd.get("imap_use_ssl") === "1";
  if (data.password === "" && id) delete data.password;
  if (data.password === "") delete data.password;
  if (id) {
    await api(`/api/accounts/${id}`, { method: "PUT", body: JSON.stringify(data) });
    toast("Account updated");
  } else {
    await api("/api/accounts", { method: "POST", body: JSON.stringify(data) });
    toast("Account added");
  }
  _outlookEmail = null;
  closeModal();
  scheduleAccountsRender();
  loadSidebarAccounts();
  if (id && $("#detailContent")?.style.display !== "none") {
    showAccountDetail(id);
  }
}

async function deleteAccount(id) {
  try {
    const accounts = await api("/api/accounts");
    const a = accounts.find(x => x.id === id);
    const name = a ? esc(a.email) : `#${id}`;
    const count = a ? a.email_count : 0;

    openModal(`<div style="text-align:center">
      <div style="font-size:2.5rem;margin-bottom:.75rem">🗑</div>
      <h3 style="margin-bottom:.25rem">Delete account</h3>
      <p style="color:var(--text-tertiary);font-size:.85rem;margin-bottom:1.5rem">
        What do you want to do with <strong>${name}</strong>?
        ${count > 0 ? `<br>It currently has <strong>${count}</strong> stored emails.` : ""}
      </p>
      <div style="display:flex;flex-direction:column;gap:.5rem">
        <button class="confirm-btn danger" onclick="confirmDeleteAccount(${id}, false)">
          🗑 Delete account only
          <span style="display:block;font-size:.72rem;font-weight:400;opacity:.7">Imported emails are kept</span>
        </button>
        ${count > 0 ? `<button class="confirm-btn danger-full" onclick="confirmDeleteAccount(${id}, true)">
          🔥 Delete account and its ${count} emails
          <span style="display:block;font-size:.72rem;font-weight:400;opacity:.7">Everything is deleted, cannot be undone</span>
        </button>` : ""}
        <button class="confirm-btn cancel" data-action="close-modal">
          Cancel
        </button>
      </div>
    </div>`);
  } catch (e) {
    toast(`Error: ${e.message}`);
  }
}

async function confirmDeleteAccount(id, deleteEmails) {
  closeModal();
  try {
    const { task_id } = await api("/api/accounts/batch-delete", {
      method: "POST",
      body: JSON.stringify({ ids: [id], delete_emails: deleteEmails }),
    });
    showBatchDeleteProgress(task_id, 1, deleteEmails);
  } catch (e) {
    toast(`Error: ${e.message}`);
  }
}

async function fetchAccount(id, force = false) {
  const url = force ? `/api/accounts/${id}/fetch?force=true` : `/api/accounts/${id}/fetch`;
  try {
    const r = await api(url, { method: "POST" });
    toast("🔄 Sync started");
    pollFetchStatus(id);
  } catch (e) {
    if (e.message.includes("already running")) {
      toast("⏳ A sync is already in progress");
      scheduleAccountsRender();
      pollFetchStatus(id);
    } else {
      toast(`Error: ${e.message}`);
    }
  }
}

function updateSidebarFetchProgress(id, progress) {
  const el = $(`#sidebar-fetch-${id}`);
  if (!el) return;
  if (!progress) { el.textContent = "⏳ Starting..."; return; }
  let text = `⏳ ${progress.current}/${progress.total} (${progress.total_fetched} new)`;

  if (progress.year) {
    text = `📅 ${progress.year}: ${progress.year_current}/${progress.year_total} · ${text}`;
  }
  el.textContent = text;
}

function updateDetailFetchProgress(id, progress) {
  const bar = $(`#detail-fetch-bar-${id}`);
  const status = $(`#detail-fetch-status-${id}`);
  if (!bar || !status) return;
  
  const folder = $(`#detail-fetch-folder-${id}`);
  const yearGroup = $(`#detail-fetch-year-group-${id}`);
  const yearBar = $(`#detail-fetch-year-bar-${id}`);
  const yearStatus = $(`#detail-fetch-year-status-${id}`);
  if (folder && progress?.folder) folder.textContent = `📁 ${progress.folder}`;

  if (progress?.year && yearGroup) {
    yearGroup.style.display = "";
    if (yearBar) {
      const ypct = progress.year_total > 0 ? Math.round((progress.year_current / progress.year_total) * 100) : 0;
      yearBar.style.width = ypct + "%";
    }
    if (yearStatus) {
      yearStatus.textContent = `📅 ${progress.year}: ${progress.year_current}/${progress.year_total}`;
    }
  } else if (yearGroup) {
    yearGroup.style.display = "none";
  }

  if (bar && progress?.total > 0) {
    const pct = Math.round((progress.current / progress.total) * 100);
    bar.style.width = pct + "%";
    status.textContent = `${progress.current} of ${progress.total} emails (${progress.total_fetched} new)`;
  } else if (bar) {
    bar.style.width = "10%";
    status.textContent = "Starting sync...";
  }
}

function completeInlineFetch(id, success, message) {
  const sidebarEl = $(`#sidebar-fetch-${id}`);
  if (sidebarEl) {
    sidebarEl.textContent = success ? `✅ ${message}` : `❌ ${message}`;
    setTimeout(() => { if (sidebarEl) sidebarEl.textContent = ""; }, 8000);
  }
  const bar = $(`#detail-fetch-bar-${id}`);
  const status = $(`#detail-fetch-status-${id}`);
  if (status) {
    if (bar) bar.style.width = "100%";
    status.innerHTML = success
      ? `<span style="color:var(--success)">✅ ${message}</span>`
      : `<span style="color:var(--danger)">❌ ${message}</span>`;
    setTimeout(() => {
      const parent = status.closest(".detail-section");
      if (parent) parent.style.display = "none";
    }, 8000);
  }
  toast(success ? `✅ ${message}` : `❌ ${message}`);
}

async function cancelFetch(id) {
  try {
    const r = await api(`/api/accounts/${id}/fetch/cancel`, { method: "POST" });
    toast("Fetch cancelled");

    completeInlineFetch(
      id,
      false,
      "Sync cancelled"
    );
  } catch (e) {
    toast(`Error: ${e.message}`);
  }
}

function updateFetchStatusDivFromStatus(id, s) {
  const el = $(`#fetch-status-${id}`);
  if (!el) return;
  if (s.status === "running") {
    el.textContent = s.progress
      ? `⏳ ${s.progress.folder || ""} ${s.progress.current}/${s.progress.total} (${s.progress.total_fetched} new)`
      : "⏳ Starting sync...";
  } else if (s.status === "done") {
    el.textContent = "";
  } else if (s.status === "error") {
    el.textContent = `❌ ${s.message || ""}`;
  } else {
    el.textContent = "";
  }
}

async function updateFetchStatusDiv(id) {
  const el = $(`#fetch-status-${id}`);
  if (!el) return;
  try {
    const s = await api(`/api/accounts/${id}/fetch-status`);
    updateFetchStatusDivFromStatus(id, s);
  } catch (e) { el.textContent = ""; }
}

const fetchPollers = {};
const pendingProgressUpdates = {};
const progressFrames = {};

function scheduleProgressUpdate(id, progress) {
  pendingProgressUpdates[id] = progress;

  // Evita múltiples repaint por frame
  if (progressFrames[id]) return;

  progressFrames[id] = requestAnimationFrame(() => {
    const p = pendingProgressUpdates[id];
    if (p) {
      updateSidebarFetchProgress(id, p);
      updateDetailFetchProgress(id, p);
    }
    delete pendingProgressUpdates[id];
    delete progressFrames[id];
  });
}

function pollFetchStatus(id) {
  // Cerrar conexión previa si existe
  if (fetchPollers[id]) return;

  const token = (
    localStorage.getItem("mailsilo_token") ||
    AUTH_TOKEN ||
    sessionStorage.getItem("mailsilo_token") ||
    ""
  ).trim();

  // Construimos la URL. Si hay token, lo enviamos, si no, lo omitimos
  let url = `${API}/api/accounts/${id}/fetch-progress`;
  if (token) {
    url += `?token=${encodeURIComponent(token)}`;
  }
  
  console.log("DEBUG: Opening SSE:", url);


  const es = new EventSource(url);
  fetchPollers[id] = es;
  let reconnectTimer = null;

  const cleanup = () => {
    if (progressFrames[id]) {
      cancelAnimationFrame(progressFrames[id]);
      delete progressFrames[id];
    }
    delete pendingProgressUpdates[id];
  };

  const done = () => {
    cleanup();
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (fetchPollers[id]) {
      fetchPollers[id].close();
      delete fetchPollers[id];
    }
  };

  // =========================
  // FALLBACK: captura cualquier evento SSE
  // =========================
  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      const p = data.progress || data;
      if (data.status === "done") {
        done();
        completeInlineFetch(id, true, data.message || "Completed");
      } else if (data.status === "error") {
        done();
        completeInlineFetch(id, false, data.message || "Error");
      } else if (data.current !== undefined || p.current !== undefined) {
        scheduleProgressUpdate(id, p);
        const el = document.getElementById(`fetch-status-${id}`);
        if (el) {
          el.textContent = `⏳ ${p.folder || ""} ${p.current || 0}/${p.total || 0} (${p.total_fetched || 0} new)`;
        }
      }
    } catch (err) {
      console.error("Error parsing SSE message:", err);
    }
  };

  // =========================
  // PROGRESS (event-name based)
  // =========================
  es.addEventListener("progress", (e) => {
    try {
      const data = JSON.parse(e.data);
      const p = data.progress || data;
      scheduleProgressUpdate(id, p);
      const el = document.getElementById(`fetch-status-${id}`);
      if (el) {
        el.textContent = `⏳ ${p.folder || ""} ${p.current || 0}/${p.total || 0} (${p.total_fetched || 0} new)`;
      }
    } catch (err) {
      console.error("Error parsing progress event:", err);
    }
  });

  // =========================
  // STATUS (event-name based)
  // =========================
  es.addEventListener("status", async (e) => {
    try {
      const data = JSON.parse(e.data);
      const msg = data.message || "";
      done();
      if (data.status === "done") {
        completeInlineFetch(id, true, msg);
        await scheduleAccountsRender();
        loadStats();
        if (state.view === "inbox" || state.view === "folder") renderView();
      } else if (data.status === "error") {
        completeInlineFetch(id, false, msg);
      }
    } catch (err) {
      console.error("Error parsing status event:", err);
      done();
    }
  });

  // =========================
  // ERROR
  // =========================
  es.onerror = () => {
    console.warn("SSE connection error, will retry in 3s");
    const el = document.getElementById(`fetch-status-${id}`);
    if (el) {
      el.textContent = "🔄 Retrying connection...";
    }
    cleanup();
    if (!reconnectTimer && fetchPollers[id] !== undefined) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        pollFetchStatus(id);
      }, 3000);
    }
  };

  es.onopen = () => {
    console.log("SSE connected successfully!");
    const el = document.getElementById(`fetch-status-${id}`);
    if (el) {
      el.textContent = "⏳ Starting sync...";
    }
  };
}

function stopAllPollers() {
  Object.keys(fetchPollers).forEach(id => {
    fetchPollers[id].close();
    delete fetchPollers[id];
  });
}

async function fetchAllAccounts() {
  const btn = document.querySelector("[data-action='fetch-all']");
  if (btn) { btn.style.pointerEvents = "none"; btn.style.opacity = ".5"; }
  try {
    const r = await api("/api/fetch-all", { method: "POST" });
    const total = Object.values(r).reduce((a, b) => a + (b > 0 ? b : 0), 0);
    toast(`✅ ${total} new emails`);
  } catch (e) {
    toast(`Error: ${e.message}`);
  }
  if (btn) { btn.style.pointerEvents = ""; btn.style.opacity = ""; }
  loadStats();
}

async function loadStats() {
  try {
    const s = await api("/api/stats");
    const el = $("#stats");
    if (el) {
      const sz = formatBytes(s.total_size);
      el.textContent = `📧 ${s.total_emails} · 📋 ${s.total_accounts} · 💾 ${sz}`;
    }
  } catch (e) {}
}

async function renderImport() {
  let html = `<div class="import-header">
    <h2>📥 Import emails</h2>
    <p>Drag and drop files or click to select. Supports EML, PST, OST and MBOX.</p>
  </div>
  <div class="import-tabs" id="importTabs">
    <div class="import-tab active" data-import="eml">EML</div>
    <div class="import-tab" data-import="pst">PST</div>
    <div class="import-tab" data-import="ost">OST</div>
    <div class="import-tab" data-import="mbox">MBOX</div>
  </div>
  <div class="import-area" id="dropZone">
    <div class="import-icon">📂</div>
    <p class="label">Drag files here</p>
    <p class="hint">or click to select</p>
    <input type="file" id="fileInput" style="display:none" accept=".eml,.pst,.ost,.mbox" multiple>
  </div>
  <div class="import-select">
    <select id="importAccountId">
      <option value="0">Auto-create account</option>
    </select>
  </div>
  <div id="importResult"></div>`;
  $("#listPanelBody").innerHTML = html;
  loadAccountSelect();
  setupImportDrop();
  setupImportTabs();
}

function setupImportDrop() {
  const zone = $("#dropZone");
  const input = $("#fileInput");
  if (!zone || !input) return;
  zone.addEventListener("click", () => input.click());
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("dragover"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("dragover");
    const files = [...e.dataTransfer.files];
    if (files.length) processImportFiles(files);
  });
  input.addEventListener("change", () => {
    const files = [...input.files];
    if (files.length) processImportFiles(files);
    input.value = "";
  });
}

async function processImportFiles(files) {
  if (files.length === 0) return;
  if (files.length === 1) {
    await handleFile(files[0]);
    return;
  }

  const accountId = parseInt($("#importAccountId").value) || 0;
  const total = files.length;
  let totalImported = 0;
  let errors = [];

  const showProgress = (i, file, msg, pct) => {
    const rd = $("#importResult");
    if (!rd) return;
    rd.innerHTML = `<div class="import-progress-card">
      <div class="filename">📄 File ${i + 1} of ${total}</div>
      <div class="filemeta">${esc(file.name)}</div>
      <div class="import-progress-bar">
        <div class="import-progress-bar-fill" style="width:${pct}%"></div>
      </div>
      <div class="import-progress-status">${msg}</div>
    </div>`;
  };

  const waitForTask = (taskId) => new Promise((resolve, reject) => {
    const poll = () => {
      api(`/api/import/status/${taskId}`).then(s => {
        if (s.status === "done") resolve(s.imported || 0);
        else if (s.status === "error") reject(new Error(s.error || "Task error"));
        else setTimeout(poll, 1500);
      }).catch(() => setTimeout(poll, 3000));
    };
    poll();
  });

  for (let i = 0; i < total; i++) {
    const file = files[i];
    const ext = file.name.split(".").pop().toLowerCase();

    if (!["eml", "pst", "ost", "mbox"].includes(ext)) {
      errors.push(`${file.name}: unsupported format`);
      continue;
    }

    showProgress(i, file, `Uploading ${esc(file.name)}...`, Math.round((i / total) * 100));

    try {
      if (ext === "eml") {
        const form = new FormData();
        form.append("file", file);
        form.append("account_id", accountId);
        const res = await fetch(API + "/api/import/eml", {
          method: "POST", headers: authHeaders(), body: form,
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.detail || `Error ${res.status}`);
        }
        const data = await res.json();
        totalImported += data.imported || 0;
        showProgress(i, file, `✅ ${data.imported || 0} emails`, Math.round(((i + 1) / total) * 100));
      } else {
        const form = new FormData();
        form.append("file", file);
        form.append("account_id", accountId);

        const taskId = await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          let uploadComplete = false;
          xhr.open("POST", API + `/api/import/${ext}`);
          for (const [k, v] of Object.entries(authHeaders())) xhr.setRequestHeader(k, v);
          xhr.upload.onload = () => { uploadComplete = true; };
          xhr.upload.onprogress = (e) => {
            if (!e.lengthComputable) return;
            if (e.loaded === e.total) uploadComplete = true;
            const pct = Math.round((i / total) * 100 + (e.loaded / e.total) * (100 / total));
            showProgress(i, file, `Uploading... ${Math.round((e.loaded / e.total) * 100)}%`, pct);
          };
          xhr.onload = () => {
            try {
              const d = JSON.parse(xhr.responseText);
              if (xhr.status >= 200 && xhr.status < 300) resolve(d.task_id);
              else reject(new Error(d.detail || `Error ${xhr.status}`));
            } catch { reject(new Error("Invalid response")); }
          };
          xhr.onerror = () => {
            if (uploadComplete) {
              showProgress(i, file, "Waiting for processing...", Math.round(((i + 0.5) / total) * 100));
              let retries = 0;
              const findTask = () => {
                api("/api/import/active").then(active => {
                  const entries = Object.entries(active);
                  if (entries.length) {
                    const [tid] = entries[0];
                    resolve(tid);
                  } else if (++retries < 10) {
                    setTimeout(findTask, 2000);
                  } else {
                    reject(new Error("Connection error"));
                  }
                }).catch(() => {
                  if (++retries < 10) setTimeout(findTask, 2000);
                  else reject(new Error("Connection error"));
                });
              }
            }
          };
          xhr.timeout = 600000;
          xhr.send(form);
        });

        showProgress(i, file, `Processing ${esc(file.name)}...`, Math.round(((i + 0.5) / total) * 100));
        const n = await waitForTask(taskId);
        totalImported += n;
        showProgress(i, file, `✅ ${n} emails`, Math.round(((i + 1) / total) * 100));
      }
    } catch (e) {
      errors.push(`${file.name}: ${e.message}`);
    }
  }

  const rd = $("#importResult");
  if (errors.length === 0) {
    rd.innerHTML = `<div class="import-progress-card">
      <div style="font-size:1.2rem;font-weight:600;color:var(--success)">✅ ${totalImported} emails imported from ${total} files</div>
    </div>`;
    toast(`${totalImported} emails imported`);
  } else {
    rd.innerHTML = `<div class="import-progress-card">
      <div style="font-size:1rem;font-weight:600;color:var(--success)">✅ ${totalImported} emails imported</div>
      <div style="font-size:.85rem;color:var(--danger);margin-top:.5rem">❌ ${errors.length} error(s)</div>
      <details style="margin-top:.5rem;font-size:.8rem">
        <summary style="cursor:pointer;color:var(--warning)">View errors</summary>
        <ul style="margin:.3rem 0 0 1rem;color:var(--text-tertiary);max-height:200px;overflow-y:auto">
          ${errors.map(e => `<li>${esc(e)}</li>`).join("")}
        </ul>
      </details>
    </div>`;
    toast(`${totalImported} emails imported, ${errors.length} errors`);
  }
  const sdiv = $("#sidebarImportProgress");
  const sbar = $("#sidebarImportBar");
  const stxt = $("#sidebarImportText");
  if (sbar) sbar.style.width = "100%";
  if (stxt) stxt.innerHTML = `<span style="color:var(--success)">✅ ${totalImported} emails imported</span>`;
  setTimeout(() => { if (sdiv) sdiv.style.display = "none"; }, 5000);
  loadStats();
  loadSidebarAccounts();
}

async function loadAccountSelect() {
  const accounts = await api("/api/accounts");
  const sel = $("#importAccountId");
  for (const a of accounts) {
    const opt = document.createElement("option");
    opt.value = a.id;
    opt.textContent = `${a.email} (${a.name})`;
    sel.appendChild(opt);
  }
  const opt = document.createElement("option");
  opt.value = "-1";
  opt.textContent = "➕ Create new account...";
  sel.appendChild(opt);
}

let activeImportTask = null;

const importTasks = new Map();

function sidebarCancelImport() {

  if (!activeImportTask) return;

  cancelMboxImport(activeImportTask);

  toast("Import cancelled");
  const sdiv = $("#sidebarImportProgress");

  if (sdiv) {
    sdiv.style.display = "none";
  }
}

function updateSidebarImport(s) {
  const sdiv = $("#sidebarImportProgress");
  const sbar = $("#sidebarImportBar");
  const stxt = $("#sidebarImportText");
  const scancel = $("#sidebarImportCancelBtn");
  if (!sdiv) return;
  sdiv.style.display = "";
  if (s.status === "processing") {
    let pct = 0;
    if (s.total > 0) {
      pct = Math.min(Math.round((s.current / s.total) * 100), 99);
    }
    if (sbar) { sbar.style.width = pct + "%"; sbar.classList.remove("indeterminate"); }
    if (scancel) scancel.style.display = "";
    if (stxt) { stxt.style.color = ""; stxt.textContent = s.message || `${pct}%`; }
  } else if (s.status === "done") {
    if (sbar) { sbar.style.width = "100%"; sbar.classList.remove("indeterminate"); }
    if (scancel) scancel.style.display = "none";
    if (stxt) { stxt.textContent = `✅ ${s.imported} emails imported`; stxt.style.color = "var(--success)"; }
    setTimeout(() => { const sd = $("#sidebarImportProgress"); if (sd) sd.style.display = "none"; }, 5000);
  } else if (s.status === "error") {
    if (scancel) scancel.style.display = "none";
    if (sbar) sbar.classList.remove("indeterminate");
    if (stxt) { stxt.textContent = `❌ ${s.error || "Error"}`; stxt.style.color = "var(--danger)"; }
    setTimeout(() => { const sd = $("#sidebarImportProgress"); if (sd) sd.style.display = "none"; }, 5000);
  }
}

async function checkActiveImports() {
  try {
    const active = await api("/api/import/active");
    const entries = Object.entries(active);
    if (!entries.length) return;
    const [tid, task] = entries[0];
    activeImportTask = tid;

    if (task.status === "uploading") return;

    const existing = importTasks.get(tid);
    if (existing && existing.running) return;

    const ct = {
      cancelled: false,
      xhr: null,
      poller: null,
      running: false,
      destroyed: false,
    };
    importTasks.set(tid, ct);
    activeImportTask = tid;

    startImportPolling(tid, {
      onUpdate(s) {
        const sdiv = $("#sidebarImportProgress");
        const sbar = $("#sidebarImportBar");
        const stxt = $("#sidebarImportText");
        if (sdiv) sdiv.style.display = "";
        if (s.status === "processing") {
          let pct = 0;
          if (s.total > 0) pct = Math.min(Math.round((s.current / s.total) * 100), 99);
          const msg = s.message || `Processing... ${s.current || 0}/${s.total || 0}`;
          if (sbar) sbar.style.width = pct + "%";
          if (stxt) stxt.textContent = msg;
        }
      },
      onDone(s) {
        const sdiv = $("#sidebarImportProgress");
        const sbar = $("#sidebarImportBar");
        const stxt = $("#sidebarImportText");
        const sbtn = $("#sidebarImportCancelBtn");
        if (s.status === "done") {
          if (sbar) sbar.style.width = "100%";
          if (stxt) stxt.innerHTML = `<span style="color:var(--success)">✅ ${s.imported} emails imported</span>`;
          if (sbtn) sbtn.remove();
          toast(`${s.imported} emails imported`);
          loadStats();
          loadSidebarAccounts();
          setTimeout(() => { const sd = $("#sidebarImportProgress"); if (sd) sd.style.display = "none"; }, 5000);
        } else if (s.status === "error") {
          if (sbar) sbar.style.background = "var(--danger)";
          if (stxt) stxt.innerHTML = `<span style="color:var(--danger)">❌ ${s.error || "Error"}</span>`;
          if (sbtn) sbtn.remove();
          setTimeout(() => { const sd = $("#sidebarImportProgress"); if (sd) sd.style.display = "none"; }, 5000);
        }
        activeImportTask = null;
      },
    });
  } catch (e) {}
}

function cancelMboxImport(task_id) {

  const task = importTasks.get(task_id);

  if (!task) return;

  task.cancelled = true;

  if (task.xhr && task.xhr.readyState !== 4) {
    task.xhr.abort();
  }

  if (task.poller) {
    clearTimeout(task.poller);
  }

  importTasks.delete(task_id);

  activeImportTask = null;

  const stxt = $("#sidebarImportText");
  const sbtn = $("#sidebarImportCancelBtn");

  if (stxt) {
    stxt.innerHTML = `
      <span style="color:var(--warning)">
        ⏹ Cancelando...
      </span>
    `;
  }

  if (sbtn) {
    sbtn.disabled = true;
  }
}

const MAX_IMPORT_SIZE = 10 * 1024 * 1024 * 1024;

async function handleFile(file) {
  if (file.size > MAX_IMPORT_SIZE) {
    toast(`File too large (max 10GB)`);
    return;
  }

  const parts = file.name.split(".");
  const ext = parts.length > 1
    ? parts.pop().toLowerCase()
    : "";

  if (!["eml", "pst", "ost", "mbox"].includes(ext)) {
    toast("Solo .eml, .pst, .ost y .mbox");
    return;
  }

  switchImportTab(ext === "eml" ? "eml" : ext);

  let importCounter = parseInt(localStorage.getItem("importCounter") || "0") + 1;
  let accountId = parseInt($("#importAccountId").value);

  if (accountId === 0) {
    const name = `Import ${importCounter}`;
    localStorage.setItem("importCounter", importCounter.toString());
    try {
      const newAccount = await api("/api/accounts", {
        method: "POST",
        body: JSON.stringify({ name, email: `importacion${importCounter}@placeholder.mailsilo`, imap_server: "import", imap_port: 993, imap_use_ssl: true, username: `importacion${importCounter}@placeholder.mailsilo`, password: "", folders: "INBOX" }),
      });
      accountId = newAccount.id;
    } catch (e) {
      toast(`Error creating account: ${e?.message || e || "unknown error"}`);
      return;
    }
  } else if (accountId === -1) {
    const name = prompt("Name for the new account:", "");
    if (!name) return;
    const email = prompt("Email for the new account:", "");
    if (!email) return;
    try {
      const newAccount = await api("/api/accounts", {
        method: "POST",
        body: JSON.stringify({ name, email, imap_server: "import", imap_port: 993, imap_use_ssl: true, username: email, password: "", folders: "INBOX" }),
      });
      accountId = newAccount.id;
      toast(`✅ Account "${name}" created`);
    } catch (e) {
      toast(`Error creating account: ${e?.message || e || "unknown error"}`);
      return;
    }
  }

  const sizeMB = (file.size / (1024 * 1024)).toFixed(1);

  const resultDiv = $("#importResult");

  const useInline = !activeImportTask;

  if (useInline) {
    resultDiv.innerHTML = `
      <div class="import-progress-card">
        <div class="filename">📄 ${esc(file.name)}</div>
        <div class="filemeta">${sizeMB} MB · ${ext.toUpperCase()}</div>

        <div class="import-progress-bar">
          <div id="importProgressBar" class="import-progress-bar-fill"></div>
        </div>

        <div class="import-progress-status" id="importStatus">
          Uploading file...
        </div>

        <button id="importCancelBtn" class="import-cancel-btn">
          Cancel
        </button>
      </div>
    `;
  }

  const bar = useInline ? $("#importProgressBar") : null;
  const status = useInline ? $("#importStatus") : null;
  const cancelBtn = useInline ? $("#importCancelBtn") : null;

  let cancelado = false;

  const form = new FormData();
  form.append("file", file);
  form.append("account_id", accountId);

  const xhr = new XMLHttpRequest();
  let currentTask = null;
  let uploadComplete = false;

  window._importXhr = xhr;
  window._importCancelado = false;

  xhr.open("POST", API + `/api/import/${ext}`);

  for (const [k, v] of Object.entries(authHeaders())) {
    xhr.setRequestHeader(k, v);

  }

  if (cancelBtn) {
    cancelBtn.onclick = () => {
      cancelado = true;
      window._importCancelado = true;

      xhr.abort();

      cancelBtn.disabled = true;
      cancelBtn.textContent = "Cancelling...";

      if (status) status.innerHTML = `
        <span style="color:var(--warning)">
          ⏹ Cancelando...
        </span>
      `;
    };
  }

  xhr.upload.onload = () => { uploadComplete = true; };

  xhr.upload.onprogress = (e) => {
    if (!e.lengthComputable) return;

    const pct = Math.round((e.loaded / e.total) * 100);
    if (e.loaded === e.total) uploadComplete = true;

    bar.style.width = pct + "%";

    if (status) {
      status.textContent =
        uploadComplete
          ? "Processing emails..."
          : `Uploading... ${pct}% (${(e.loaded / (1024 * 1024)).toFixed(1)}/${sizeMB} MB)`;
    }

    const sdiv = $("#sidebarImportProgress");
    const sbar = $("#sidebarImportBar");
    const stxt = $("#sidebarImportText");

    if (sdiv) sdiv.style.display = "";

    if (sbar) {
      sbar.style.width = pct + "%";
    }

    if (stxt) {
      stxt.textContent = status ? status.textContent : "Uploading file...";
    }
  };

  try {
    const response = await new Promise((resolve, reject) => {
      let responded = false;

      xhr.onload = () => {
        responded = true;
        try {
          const data = JSON.parse(xhr.responseText);

          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(data);
          } else {
            reject(new Error(data.detail || `Error ${xhr.status}`));
          }

        } catch (e) {
          reject(new Error("Invalid response"));
        }
      };

      xhr.onerror = () => {
        if (uploadComplete && !responded) {
            if (status) status.textContent = "Waiting for server response...";
          setTimeout(() => {
            if (!responded) reject(new Error("Connection error"));
          }, 15000);
        } else {
          reject(new Error("Connection error"));
        }
      };

      xhr.onabort = () => reject(new Error("cancelled"));

      xhr.ontimeout = () => reject(new Error("Timed out"));

      xhr.timeout = 600000;

      xhr.send(form);
    });

    if (cancelado) return;

    /*
      ==========================================
      EML = respuesta inmediata
      ==========================================
    */

    if (ext === "eml") {

      if (bar) bar.style.width = "100%";

      if (status) status.innerHTML = `
        <span style="color:var(--success)">
          ✅ ${response.imported} emails imported
        </span>
      `;

      if (cancelBtn) cancelBtn.remove();

      const sdiv = $("#sidebarImportProgress");
      const sbar = $("#sidebarImportBar");
      const stxt = $("#sidebarImportText");
      if (sbar) sbar.style.width = "100%";
      if (stxt) stxt.innerHTML = `<span style="color:var(--success)">✅ ${response.imported} emails imported</span>`;
      setTimeout(() => { if (sdiv) sdiv.style.display = "none"; }, 5000);

      toast(`${response.imported} emails imported`);

      loadStats();
      loadSidebarAccounts();

      return;
    }

    /*
      ==========================================
      MBOX / PST / OST = polling
      ==========================================
    */

    const { task_id } = response;
    currentTask = {
      cancelled: false,
      xhr,
      poller: null,
      running: false,
      destroyed: false
    };

    importTasks.set(task_id, currentTask);

    activeImportTask = task_id;

    startImportPolling(task_id, {

      onUpdate(s) {

        const sdiv = $("#sidebarImportProgress");
        const sbar = $("#sidebarImportBar");
        const stxt = $("#sidebarImportText");

        if (sdiv) sdiv.style.display = "";

        if (s.status === "processing") {

          let pct = 0;

          if (s.total > 0) {
            pct = Math.min(
              Math.round((s.current / s.total) * 100),
              99
            );
          }

          const msg =
            s.message ||
            `Processing... ${s.current || 0}/${s.total || 0}`;

          if (bar) bar.style.width = pct + "%";
          if (status) status.textContent = msg;

          if (sbar) sbar.style.width = pct + "%";

          if (stxt) stxt.textContent = msg;
        }
      },

      onDone(s) {

        const sdiv = $("#sidebarImportProgress");
        const sbar = $("#sidebarImportBar");
        const stxt = $("#sidebarImportText");
        const sbtn = $("#sidebarImportCancelBtn");

        if (s.status === "done") {

          if (bar) bar.style.width = "100%";

          let extraHtml = "";
          if (s.errors && s.errors.length) {
            const showCount = Math.min(s.errors.length, 20);
            extraHtml = `
              <details style="margin-top:.5rem;font-size:.8rem">
                <summary style="cursor:pointer;color:var(--warning)">⚠ ${s.errors.length} errors (click to view)</summary>
                <ul style="margin:.3rem 0 0 1rem;color:var(--text-tertiary);max-height:200px;overflow-y:auto">
                  ${s.errors.slice(0, showCount).map(e => `<li>${esc(e)}</li>`).join("")}
                  ${s.errors.length > showCount ? `<li>... and ${s.errors.length - showCount} more</li>` : ""}
                </ul>
              </details>
            `;
          }

      if (status) status.innerHTML = `
        <span style="color:var(--success)">
          ✅ ${s.imported} emails imported
        </span>
        ${extraHtml}
      `;

          if (cancelBtn) cancelBtn.remove();

          if (sbar) sbar.style.width = "100%";
          if (stxt) stxt.innerHTML = `<span style="color:var(--success)">✅ ${s.imported} emails imported</span>`;
          if (sbtn) sbtn.remove();

          toast(`${s.imported} emails imported`);

          loadStats();
          loadSidebarAccounts();
        }

        else if (s.status === "error") {

          if (bar) bar.style.background = "var(--danger)";

          if (status) status.innerHTML = `
            <span style="color:var(--danger)">
              ❌ ${s.error || "Error"}
            </span>
          `;

          if (cancelBtn) cancelBtn.remove();

          if (sbar) sbar.style.background = "var(--danger)";
          if (stxt) stxt.innerHTML = `<span style="color:var(--danger)">❌ ${s.error || "Error"}</span>`;
          if (sbtn) sbtn.remove();
        }

        activeImportTask = null;
      }
    });

  } catch (e) {

    if (e.message === "cancelled") {

      if (status) status.innerHTML = `
        <span style="color:var(--warning)">
          ⏹ Import cancelled
        </span>
      `;

      return;
    }

    if (e.message === "Connection error" && uploadComplete) {

      if (status) status.textContent = "Waiting for processing...";

      let retries = 0;

      const findTask = async () => {
        try {
          const active = await api("/api/import/active");
          const entries = Object.entries(active);

          if (entries.length) {
            const [tid] = entries[0];

            const ct = {
              cancelled: false, xhr: null, poller: null,
              running: false, destroyed: false,
            };
            importTasks.set(tid, ct);
            activeImportTask = tid;

            if (status) status.textContent = "Processing emails...";

            startImportPolling(tid, {
              onUpdate(s) {
                const sbar = $("#sidebarImportBar");
                const stxt = $("#sidebarImportText");
                if (s.status === "processing") {
                  let pct = 0;
                  if (s.total > 0) pct = Math.min(Math.round((s.current / s.total) * 100), 99);
                  const msg = s.message || `Processing... ${s.current || 0}/${s.total || 0}`;
                  if (bar) bar.style.width = pct + "%";
                  if (status) status.textContent = msg;
                  if (sbar) sbar.style.width = pct + "%";
                  if (stxt) stxt.textContent = msg;
                }
              },
              onDone(s) {
                if (s.status === "done") {
                  if (bar) bar.style.width = "100%";
                  if (status) status.innerHTML = `<span style="color:var(--success)">              ✅ ${s.imported} emails imported</span>`;
                  if (cancelBtn) cancelBtn.remove();
                  toast(`${s.imported} emails imported`);
                  loadStats();
                  loadSidebarAccounts();
                } else if (s.status === "error") {
                  if (bar) bar.style.background = "var(--danger)";
                  if (status) status.innerHTML = `<span style="color:var(--danger)">❌ ${s.error || "Error"}</span>`;
                  if (cancelBtn) cancelBtn.remove();
                }
                const sbar = $("#sidebarImportBar");
                const stxt = $("#sidebarImportText");
                const sbtn = $("#sidebarImportCancelBtn");
                if (s.status === "done") {
                  if (sbar) sbar.style.width = "100%";
                  if (stxt) stxt.innerHTML = `<span style="color:var(--success)">✅ ${s.imported} emails imported</span>`;
                  if (sbtn) sbtn.remove();
                } else if (s.status === "error") {
                  if (sbar) sbar.style.background = "var(--danger)";
                  if (stxt) stxt.innerHTML = `<span style="color:var(--danger)">❌ ${s.error || "Error"}</span>`;
                  if (sbtn) sbtn.remove();
                }
                activeImportTask = null;
              },
            });
            return;
          }
        } catch (_) {}

        retries++;
        if (retries < 10) {
          setTimeout(findTask, 2000);
        } else {
          if (status) status.innerHTML = `<span style="color:var(--danger)">❌ Connection error</span>`;
        }
      };

      findTask();
      return;
    }

    if (status) status.innerHTML = `
      <span style="color:var(--danger)">
        ❌ Error: ${e.message}
      </span>
    `;

    console.error(e);
  } finally {
    window._importXhr = null;
    window._importCancelado = null;
  }
}

function setupImportTabs() {
  $("#importTabs").addEventListener("click", (e) => {
    const tab = e.target.closest(".import-tab");
    if (!tab) return;
    switchImportTab(tab.dataset.import);
  });
}

function switchImportTab(tab) {
  $$(".import-tab").forEach((t) => t.classList.toggle("active", t.dataset.import === tab));
  const accept = tab === "eml" ? ".eml" : tab === "pst" ? ".pst" : tab === "ost" ? ".ost" : ".mbox";
  const inp = $("#fileInput");
  if (inp) { inp.accept = accept; inp.multiple = tab === "eml"; }
}

function toggleSelectAccount(id, checked) {
  if (checked) selectedAccountIds.add(id);
  else selectedAccountIds.delete(id);
  updateAccountSelectionToolbar();
}

function toggleSelectAllAccounts(checked) {
  $$(".account-checkbox").forEach(cb => {
    cb.checked = checked;
    const id = parseInt(cb.dataset.accountId);
    if (checked) selectedAccountIds.add(id);
    else selectedAccountIds.delete(id);
  });
  updateAccountSelectionToolbar();
}

function updateAccountSelectionToolbar() {
  const toolbar = $("#accountSelectionToolbar");
  const count = $("#accountSelectionCount");
  if (!toolbar) return;
  if (selectedAccountIds.size > 0) {
    toolbar.style.display = "flex";
    count.textContent = `${selectedAccountIds.size} selected`;
  } else {
    toolbar.style.display = "none";
  }
  const selectAll = $("#selectAllAccounts");
  if (selectAll) {
    const visible = $$(".account-checkbox");
    selectAll.checked = visible.length > 0 && $$(".account-checkbox:checked").length === visible.length;
  }
}

async function batchDeleteAccounts() {
  const ids = getSelectedAccountIds();
  if (ids.length === 0) { toast("No accounts selected"); return; }

  const cuentaWord = ids.length === 1 ? "account" : "accounts";
  const N = ids.length;

  openModal(`<div style="text-align:center">
    <div style="font-size:2.5rem;margin-bottom:.75rem">🗑</div>
    <h3 style="margin-bottom:.25rem">Delete ${N} ${cuentaWord}</h3>
    <p style="color:var(--text-tertiary);font-size:.85rem;margin-bottom:1.5rem">
      What do you want to do with the selected ${N} ${cuentaWord}?
    </p>
    <div style="display:flex;flex-direction:column;gap:.5rem">
      <button class="confirm-btn danger" onclick="doBatchDelete(false, ${N})">
        🗑 Delete accounts only
        <span style="display:block;font-size:.72rem;font-weight:400;opacity:.7">Imported emails are kept</span>
      </button>
      <button class="confirm-btn danger-full" onclick="doBatchDelete(true, ${N})">
        🔥 Delete accounts and their emails
        <span style="display:block;font-size:.72rem;font-weight:400;opacity:.7">Everything is deleted, cannot be undone</span>
      </button>
      <button class="confirm-btn cancel" data-action="close-modal">Cancel</button>
    </div>
  </div>`);
}

function getSelectedAccountIds() {
  return $$(".account-checkbox:checked").map(cb => parseInt(cb.dataset.accountId)).filter(id => !isNaN(id));
}



async function doBatchDelete(deleteEmails, expectedCount) {
  closeModal();
  const ids = getSelectedAccountIds();
  if (ids.length === 0) { toast("Error: no accounts selected"); return; }
  selectedAccountIds.clear();
  updateAccountSelectionToolbar();

  let total = ids.length;
  try {
    const { task_id } = await api("/api/accounts/batch-delete", {
      method: "POST",
      body: JSON.stringify({ ids, delete_emails: deleteEmails }),
    });
    showBatchDeleteProgress(task_id, total, deleteEmails);
  } catch (e) {
    toast(`Error: ${e.message}`);
  }
}

function showBatchDeleteProgress(task_id, total, deleteEmails) {
  stopBatchDeletePoller();

  const sdiv = $("#sidebarDeleteProgress");
  const sbar = $("#sidebarDeleteBar");
  const stxt = $("#sidebarDeleteText");
  if (sdiv) sdiv.style.display = "";

  let retries = 0;
  const MAX_RETRIES = 5;

    const done = (success, msg) => {
    if (sbar) { sbar.style.width = "100%"; if (!success) sbar.style.background = "var(--danger)"; }
    if (stxt) stxt.innerHTML = success
      ? `<span style="color:var(--success)">✅ ${msg}</span>`
      : `<span style="color:var(--danger)">❌ ${msg}</span>`;
    scheduleAccountsRender();
    loadStats();
    loadSidebarAccounts();
    setTimeout(() => { if (sdiv) sdiv.style.display = "none"; }, 5000);
  };

  const poll = () => {
    batchDeletePoller = setTimeout(async () => {
      try {
        const s = await api(`/api/accounts/batch-delete/status/${task_id}`);
        retries = 0;
        const pct = s.total > 0 ? Math.round((s.current / s.total) * 100) : 0;

        if (s.status === "running" || s.status === "cancelling") {
          if (sbar) sbar.style.width = pct + "%";
          if (stxt) {
      if (s.phase === "Deleting emails") {
        stxt.textContent = `Deleting emails: ${s.current} of ${s.total}`;
      } else if (s.phase === "Deleting folders") {
        stxt.textContent = `Deleting folders... ${pct}%`;
      } else if (s.phase === "Deleting accounts") {
        stxt.textContent = `Deleting accounts... ${pct}%`;
      } else if (s.phase === "Saving changes...") {
        stxt.textContent = `Saving changes... ${pct}%`;
      } else {
        stxt.textContent = `${s.phase || "Processing..."} ${pct}%`;
            }
          }
          poll();
        } else if (s.status === "done") {
          const msg = deleteEmails
            ? `${s.deleted} account(s) and their emails deleted`
            : `${s.deleted} account(s) deleted (emails kept)`;
          done(true, msg);
        } else if (s.status === "cancelled") {
          const msg = deleteEmails
            ? `Cancelled (${s.deleted} account(s) deleted)`
            : `Cancelled`;
          done(true, msg);
        } else if (s.status === "error") {
          done(false, s.error || "Unknown error");
        }
      } catch (e) {
        retries++;
        if (retries >= MAX_RETRIES) {
          done(false, "Connection error");
          return;
        }
        poll();
      }
    }, 1000);
  };
  poll();
}

window.addEventListener("beforeunload", () => {

  stopAllPollers();

  for (const [, task] of importTasks) {
    if (task.poller) clearTimeout(task.poller);
    if (task.xhr) task.xhr.abort();
  }
});

async function startImportPolling(task_id, handlers = {}) {

  const existing = importTasks.get(task_id);

  if (!existing) return;

  if (existing.running) return;

  existing.running = true;

  async function tick() {

    const task = importTasks.get(task_id);

    if (!task || task.cancelled || task.destroyed) {
      existing.running = false;
      return;
    }

    try {

      const s = await api(`/api/import/status/${task_id}`);

      handlers.onUpdate?.(s);

      if (s.status === "processing") {

        if (task.poller) {
          clearTimeout(task.poller);
        }

        task.poller = setTimeout(tick, 1500);

      } else {

        try {
          handlers.onDone?.(s);
        } finally {
          existing.running = false;
          importTasks.delete(task_id);
        }
      }

    } catch (e) {

      console.error(e);

      const task = importTasks.get(task_id);

      if (!task || task.cancelled) {
        existing.running = false;
        return;
      }

      if (task.poller) {
        clearTimeout(task.poller);
      }

      task.poller = setTimeout(tick, 3000);
    }
  }

  tick();
}

async function cancelBatchDelete(task_id) {
  try {
    await api(`/api/accounts/batch-delete/${task_id}/cancel`, { method: "POST" });
    toast("Cancelling deletion...");
  } catch (e) {
    toast(`Error: ${e.message}`);
  }
}
