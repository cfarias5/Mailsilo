let selectedIds = new Set();

let inboxFilter = "";

function applyInboxFilter(items, tree) {
  if (!inboxFilter) return items;
  if (inboxFilter.startsWith("acct:")) {
    const acctId = parseInt(inboxFilter.slice(5));
    return items.filter(i => i.accountId === acctId);
  }
  // folder filter
  return items.filter(i => i.folderName === inboxFilter);
}

async function renderInbox() {
  const tree = await api("/api/folders");
  const total = tree.reduce((s, a) => s + a.folders.reduce((s2, f) => s2 + f.count, 0), 0);
  const selectedId = state.selectedEmailId;

  setSplitView(true);
  setListTitle("Correos", `${total} correos`);

  const dp = $("#detailPanel");
  if (dp) dp.classList.remove("show-mobile");

  if (tree.length === 0) {
    $("#listPanelBody").innerHTML = `<div class="empty-state">No hay correos. Añade una cuenta o importa un archivo.</div>`;
    if (!selectedId) showDetailEmpty();
    return;
  }

  // Build all items
  let allItems = [];
  for (const acct of tree) {
    for (const f of acct.folders) {
      allItems.push({ accountEmail: acct.account_email, accountName: acct.account_name, accountId: acct.account_id, folderName: f.name, count: f.count });
    }
  }

  const items = applyInboxFilter(allItems, tree);
  const filteredTotal = items.reduce((s, i) => s + i.count, 0);

  // Build grouped dropdown options
  let ddOptions = `<option value="">📂 Todas las carpetas (${total} correos)</option>`;
  for (const acct of tree) {
    const name = acct.account_name || acct.account_email;
    const shortName = name.replace(/@.*$/, "");
    const isAcctSelected = inboxFilter === `acct:${acct.account_id}`;
    ddOptions += `<option value="acct:${acct.account_id}" ${isAcctSelected ? "selected" : ""}>📋 ${esc(shortName)}</option>`;
  }

  let html = `<div class="inbox-filter-bar">
    <select id="inboxFilterSelect" onchange="inboxFilter=this.value; renderInbox()">
      ${ddOptions}
    </select>
  </div>`;

  if (items.length === 0) {
    html += `<div class="empty-state">Sin correos en esta carpeta</div>`;
    $("#listPanelBody").innerHTML = html;
    return;
  }

  for (const item of items) {
    const displayName = item.accountName || item.accountEmail;
    const shortName = displayName.replace(/@.*$/, "");
    html += `<div class="email-list-item inbox-folder-row" data-action="show-folder" data-account-id="${item.accountId}" data-account-email="${esc(item.accountEmail)}" data-folder-name="${esc(item.folderName)}">
      <span class="inbox-folder-name">📁 ${esc(item.folderName)}</span>
      <span class="inbox-folder-acct">(${esc(shortName)})</span>
      <span class="inbox-folder-count">${item.count}</span>
    </div>`;
  }
  $("#listPanelBody").innerHTML = html;
}

async function showFolder(accountEmail, folderName, accountId) {
  state.view = "folder";
  state.folder = { accountEmail, folderName, accountId, page: 1 };
  state.selectedEmailId = null;
  renderFolder();
}

function sortToolbarHtml() {
  const dir = state.sortOrder === "asc" ? "↑" : "↓";
  const opts = [
    { value: "date", label: "Fecha" },
    { value: "subject", label: "Asunto" },
    { value: "sender", label: "Remitente" },
  ].map(o => `<option value="${o.value}" ${state.sortBy === o.value ? "selected" : ""}>${o.label}</option>`).join("");
  return `<div class="sort-bar">
    <select id="sortBySelect" onchange="state.sortBy=this.value; state.folder.page=1; renderFolder()">${opts}</select>
    <button class="btn-sm outline" id="sortDirBtn" onclick="state.sortOrder=state.sortOrder==='asc'?'desc':'asc'; state.folder.page=1; renderFolder()" style="font-size:1rem;line-height:1;padding:.3rem .6rem">${dir}</button>
  </div>`;
}

async function renderFolder() {
  const f = state.folder;
  const data = await api(`/api/emails?folder=${encodeURIComponent(f.folderName)}&account_id=${f.accountId}&page=${f.page}&per_page=50&sort_by=${state.sortBy}&sort_order=${state.sortOrder}`);

  setSplitView(true);
  setListTitle(`${esc(f.folderName)}`, `${data.total} correos · ${esc(f.accountEmail)}`);
  showDetailEmpty();
  selectedIds.clear();
  updateSelectionToolbar();

  if (data.items.length === 0) {
    $("#listPanelBody").innerHTML = `<div class="empty-state">Sin correos en esta carpeta</div>`;
    return;
  }

  let html = `<div class="selection-toolbar" id="selectionToolbar" style="display:none">
    <label class="select-all-label"><input type="checkbox" id="selectAllCheckbox" onchange="toggleSelectAll(this.checked)"> <span id="selectionCount">0 seleccionados</span></label>
    <button class="btn-sm danger" data-action="delete-selected">🗑 Eliminar seleccionados</button>
    <button class="btn-sm" data-action="export-selected">📦 Exportar seleccionados</button>
  </div>`;
  html += sortToolbarHtml();
  for (const e of data.items) {
    html += renderEmailListItem(e);
  }
  html += pagination(data.total, data.page, data.per_page, "change-folder-page");
  $("#listPanelBody").innerHTML = html;
}

function renderEmailListItem(e) {
  const isUnread = !e.is_read;
  const isSelected = state.selectedEmailId === e.id;
  const initials = (e.sender_name || e.sender_email || "?")[0].toUpperCase();
  const colors = ["#0d9488", "#6366f1", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#ef4444"];
  const colorIdx = (e.sender_email || e.id).length % colors.length;
  const date = e.date ? formatDate(e.date) : "";
  const hasAtt = e.has_attachments;
  const preview = (e.body_text || "").replace(/\n/g, " ").substring(0, 80);
  const checked = selectedIds.has(e.id) ? "checked" : "";

  return `<div class="email-list-item ${isUnread ? "unread" : "read"} ${isSelected ? "selected" : ""}" data-action="show-email" data-email-id="${e.id}">
    <input type="checkbox" class="email-checkbox" data-email-id="${e.id}" ${checked} onclick="event.stopPropagation()" onchange="toggleSelectEmail(${e.id}, this.checked)">
    <div class="email-unread-dot"></div>
    <div class="email-avatar${hasAtt ? " has-attachment" : ""}" style="background:${colors[colorIdx]}">${initials}</div>
    <div class="email-content">
      <div class="email-row1">
        <span class="email-sender">${esc(e.sender_name || e.sender_email || "(desconocido)")}</span>
        <span class="email-date">${date}</span>
      </div>
      <div class="email-subject">${esc(e.subject || "(sin asunto)")}</div>
      <div class="email-preview">${esc(preview)}</div>
    </div>
  </div>`;
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now - d;
  const oneDay = 86400000;
  if (diff < oneDay && d.getDate() === now.getDate()) {
    return d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
  }
  if (diff < 7 * oneDay) {
    return d.toLocaleDateString("es", { weekday: "short" });
  }
  return d.toLocaleDateString("es", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

async function showEmail(id) {
  state.selectedEmailId = id;
  setSplitView(true);
  const dp = $("#detailPanel");
  if (dp) dp.classList.add("show-mobile");

  // Restore detail panel structure if overwritten (e.g. by showAccountDetail)
  if (!$("#detailSubject")) {
    $("#detailContent").innerHTML = `
      <div class="detail-header">
        <div class="detail-subject" id="detailSubject"></div>
        <div class="detail-meta" id="detailMeta"></div>
      </div>
      <div class="detail-body" id="detailBody"></div>
      <div class="detail-attachments" id="detailAttachments"></div>
      <div class="detail-actions" id="detailActions"></div>
    `;
  }

  // Update selection in list
  $$(".email-list-item.selected").forEach(el => el.classList.remove("selected"));
  const listItem = $(`.email-list-item[data-email-id="${id}"]`);
  if (listItem) listItem.classList.add("selected");

  $("#detailBody").innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-tertiary)">Cargando...</div>';

  if (!emailCache[id]) {
    emailCache[id] = api(`/api/emails/${id}`).catch((err) => {
      delete emailCache[id];
      throw err;
    });
  }
  let e;
  try {
    e = await emailCache[id];
    cacheSet(id, e);
  } catch (e) {
    $("#detailBody").innerHTML = '<div style="text-align:center;padding:2rem;color:var(--danger)">Error al cargar el correo</div>';
    return;
  }

  e.is_read = true;
  if (listItem) {
    listItem.classList.remove("unread");
    listItem.classList.add("read");
    const dot = listItem.querySelector(".email-unread-dot");
    if (dot) dot.style.background = "transparent";
  }

  // Populate detail panel
  const detailContent = $("#detailContent");
  const detailEmpty = $("#detailEmpty");
  detailContent.style.display = "flex";
  detailEmpty.style.display = "none";

  // Subject
  $("#detailSubject").textContent = e.subject || "(sin asunto)";

  // Meta
  let metaHtml = "";
  const metaFields = [
    ["De:", `${esc(e.sender_name || e.sender_email)} <a href="mailto:${esc(e.sender_email)}">${esc(e.sender_email)}</a>`],
    ["Para:", esc(e.recipients_to || "")],
  ];
  if (e.recipients_cc) metaFields.push(["CC:", esc(e.recipients_cc)]);
  metaFields.push(["Fecha:", e.date ? new Date(e.date).toLocaleString("es") : ""]);
  if (e.folder) metaFields.push(["Carpeta:", esc(e.folder)]);

  for (const [label, value] of metaFields) {
    metaHtml += `<div class="detail-meta-row"><span class="detail-meta-label">${label}</span><span class="detail-meta-value">${value}</span></div>`;
  }
  $("#detailMeta").innerHTML = metaHtml;

  // Body
  const bodyEl = $("#detailBody");
  const mode = e.body_html ? "html" : "text";
  if (mode === "html") {
    bodyEl.innerHTML = `<iframe id="detailEmailBody" sandbox="allow-same-origin"></iframe>`;
    const iframe = $("#detailEmailBody");
    if (iframe) {
      iframe.srcdoc = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width"><style>body{max-width:100%;overflow-wrap:break-word;word-break:break-word;margin:0;padding:1rem;font-family:system-ui,sans-serif;line-height:1.6;color:#1a1a1a}img{max-width:100%;height:auto}</style></head><body>${DOMPurify.sanitize(e.body_html)}</body></html>`;
    }
  } else {
    bodyEl.innerHTML = `<pre>${esc(e.body_text || "")}</pre>`;
  }

  // Attachments
  const attEl = $("#detailAttachments");
  if (e.attachments && e.attachments.length > 0) {
    let attHtml = `<div class="detail-attachments-label">${e.attachments.length} adjunto(s)</div>`;
    for (const a of e.attachments) {
      if (isImageType(a.content_type)) {
        attHtml += `<a href="/api/emails/${e.id}/attachment/${a.id}?token=${esc(AUTH_TOKEN)}" target="_blank" class="detail-attachment-item">
          🖼 ${esc(a.filename)} (${(a.size / 1024).toFixed(1)} KB)
        </a>`;
      } else {
        attHtml += `<a href="/api/emails/${e.id}/attachment/${a.id}?token=${esc(AUTH_TOKEN)}" download="${esc(a.filename)}" class="detail-attachment-item">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          ${esc(a.filename)} (${(a.size / 1024).toFixed(1)} KB)
        </a>`;
      }
    }
    attEl.innerHTML = attHtml;
  } else {
    attEl.innerHTML = "";
  }

  // Actions
  $("#detailActions").innerHTML = `
    <button class="primary" data-action="export-eml" data-email-id="${e.id}">📥 Exportar</button>
    <button data-action="forward-email" data-email-id="${e.id}">📤 Reenviar</button>
    <button class="danger" data-action="delete-email" data-email-id="${e.id}">🗑 Eliminar</button>
    <button style="margin-left:auto" data-action="nav" data-view="${state.view === "search" ? "search" : "inbox"}">← Volver</button>
  `;
}

async function deleteEmail(id) {
  if (!confirm("¿Eliminar este correo?")) return;
  await api(`/api/emails/${id}`, { method: "DELETE" });
  if (state.selectedEmailId === id) {
    state.selectedEmailId = null;
    showDetailEmpty();
  }
  toast("Correo eliminado");
  renderView();
}

async function forwardEmail(id) {
  openModal(`<h3 style="margin-bottom:16px">📤 Reenviar correo</h3>
    <form id="forwardForm">
      <div class="form-group"><label>Destinatario</label><input name="to" type="email" placeholder="correo@ejemplo.com" required></div>
      <div style="font-size:.78rem;color:var(--text-tertiary);margin-bottom:.5rem">Se enviará desde el servidor SMTP configurado en Ajustes. El correo original irá adjunto como cita.</div>
      <div class="form-actions" style="margin-top:1rem">
        <button type="submit" class="primary" data-action="send-forward">📤 Enviar</button>
        <button class="outline" type="button" data-action="close-modal">Cancelar</button>
      </div>
    </form>`, { closable: false });
  const form = $("#forwardForm");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const to = form.querySelector("[name=to]").value.trim();
    if (!to) return;
    const btn = form.querySelector("[data-action=send-forward]");
    btn.disabled = true;
    btn.textContent = "Enviando...";
    try {
      await api(`/api/emails/${id}/forward`, {
        method: "POST",
        body: JSON.stringify({ to }),
      });
      closeModal();
      toast(`✅ Correo reenviado a ${to}`);
    } catch (e) {
      toast(`Error: ${e.message}`);
      btn.disabled = false;
      btn.textContent = "📤 Enviar";
    }
  };
}

function showDetailEmpty() {
  $("#detailContent").style.display = "none";
  $("#detailEmpty").style.display = "flex";
  const dp = $("#detailPanel");
  if (dp) dp.classList.remove("show-mobile");
}

function setSplitView(enabled) {
  const sv = $("#splitView");
  if (enabled) {
    sv.classList.remove("full-width");
  } else {
    sv.classList.add("full-width");
  }
}

function setListTitle(title, subtitle) {
  $("#listPanelTitle").textContent = title;
  $("#listPanelCount").textContent = subtitle || "";
  $("#topbarTitle").textContent = title;
}

function renderSidebarAccounts(tree) {
  const container = $("#sidebarAccounts");
  if (!container) return;
  if (!tree || tree.length === 0) {
    container.innerHTML = `<div style="padding:.5rem .75rem;font-size:.78rem;color:var(--text-tertiary)">Sin cuentas</div>`;
    return;
  }
  let html = "";
  for (const acct of tree) {
    const initials = (acct.account_name || acct.account_email)[0].toUpperCase();
    const name = acct.account_name || acct.account_email;
    const total = acct.folders.reduce((s, f) => s + (f.count || 0), 0);
    html += `<div class="nav-item" style="flex-wrap:wrap" data-action="show-account" data-account-id="${acct.account_id}">
      <div class="email-avatar" style="width:20px;height:20px;font-size:.6rem;background:var(--accent);margin:0">${initials}</div>
      <div style="display:flex;flex-direction:column;gap:.1rem;flex:1;min-width:0">
        <span style="font-size:.82rem;line-height:1.1">${esc(name)}</span>
        <span style="font-size:.68rem;color:var(--text-tertiary);line-height:1">${esc(acct.account_email)}</span>
      </div>
      <span style="font-size:.7rem;color:var(--text-tertiary);background:var(--surface);padding:.1rem .45rem;border-radius:999px;border:1px solid var(--border)">${total}</span>
      <div id="sidebar-fetch-${acct.account_id}" style="width:100%;font-size:.7rem;color:var(--text-secondary);padding:.1rem .25rem 0;line-height:1.2"></div>
    </div>`;
  }
  container.innerHTML = html;
}

async function renderSearch() {
  setSplitView(false);
  setListTitle("Buscar", "");
  showDetailEmpty();
  let html = `<div class="page-header-body"><h2>🔍 Buscar correos</h2></div>
  <div class="search-bar">
    <svg class="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
    <input type="text" id="searchInput" placeholder="Buscar por asunto, remitente o contenido..." value="${esc(state.query)}" autofocus>
    <button class="btn-small primary" data-action="search">Buscar</button>
  </div>
  <div id="searchResults"></div>`;
  $("#listPanelBody").innerHTML = html;
  if (state.query) doSearch();
}

function sortSearchToolbarHtml() {
  const dir = state.sortOrder === "asc" ? "↑" : "↓";
  const opts = [
    { value: "date", label: "Fecha" },
    { value: "subject", label: "Asunto" },
    { value: "sender", label: "Remitente" },
  ].map(o => `<option value="${o.value}" ${state.sortBy === o.value ? "selected" : ""}>${o.label}</option>`).join("");
  return `<div class="sort-bar" style="margin-bottom:.5rem">
    <select id="sortBySearch" onchange="state.sortBy=this.value; doSearch(1)">${opts}</select>
    <button class="btn-sm outline" onclick="state.sortOrder=state.sortOrder==='asc'?'desc':'asc'; doSearch(1)" style="font-size:1rem;line-height:1;padding:.3rem .6rem">${dir}</button>
  </div>`;
}

async function doSearch(page = 1) {
  state.query = ($("#searchInput") || $("#searchInputTop")).value.trim();
  state.page = page;
  if (!state.query) return;
  const data = await api(`/api/emails?q=${encodeURIComponent(state.query)}&page=${page}&per_page=50&sort_by=${state.sortBy}&sort_order=${state.sortOrder}`);
  const container = $("#searchResults");
  if (data.items.length === 0) {
    container.innerHTML = `<div class="empty-state">Sin resultados para "${esc(state.query)}"</div>`;
    return;
  }
  let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;padding:0 .5rem">
    <span style="color:var(--text-secondary);font-size:.82rem">${data.total} resultado(s)</span>
    <button class="btn-small" data-action="export-mbox-search">📦 Exportar MBOX</button>
  </div>`;
  html += sortSearchToolbarHtml();
  for (const e of data.items) {
    html += renderEmailListItem(e);
  }
  html += pagination(data.total, data.page, data.per_page, "do-search");
  container.innerHTML = html;
}

function toggleSelectEmail(id, checked) {
  if (checked) selectedIds.add(id);
  else selectedIds.delete(id);
  updateSelectionToolbar();
}

function toggleSelectAll(checked) {
  $$(".email-checkbox").forEach(cb => {
    cb.checked = checked;
    const id = parseInt(cb.dataset.emailId);
    if (checked) selectedIds.add(id);
    else selectedIds.delete(id);
  });
  updateSelectionToolbar();
}

function updateSelectionToolbar() {
  const toolbar = $("#selectionToolbar");
  const count = $("#selectionCount");
  if (!toolbar) return;
  if (selectedIds.size > 0) {
    toolbar.style.display = "flex";
    count.textContent = `${selectedIds.size} seleccionados`;
  } else {
    toolbar.style.display = "none";
  }
  const selectAll = $("#selectAllCheckbox");
  if (selectAll) {
    const visible = $$(".email-checkbox");
    selectAll.checked = visible.length > 0 && $$(".email-checkbox:checked").length === visible.length;
  }
}

async function batchDeleteEmails() {
  if (selectedIds.size === 0) return;
  if (!confirm(`¿Eliminar ${selectedIds.size} correo(s)?`)) return;
  try {
    await api("/api/emails/batch-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selectedIds] }),
    });
    const count = selectedIds.size;
    selectedIds.clear();
    toast(`${count} correo(s) eliminados`);
    renderView();
  } catch (e) {
    toast(`Error: ${e.message}`);
  }
}
