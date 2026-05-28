let state = { view: "inbox", page: 1, query: "", folder: null, selectedEmailId: null, sortBy: "date", sortOrder: "desc" };

function navigate(view, page = 1) {
  state.view = view;
  state.page = page;
  state.folder = null;
  state.selectedEmailId = null;
  $$(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.view === view));
  renderView();
}

async function renderView() {
  showLoading(true);
  try {
    switch (state.view) {
      case "inbox": await renderInbox(); break;
      case "folder": if (state.folder) { await renderFolder(); } else { await renderInbox(); } break;
      case "search": await renderSearch(); break;
      case "accounts": setSplitView(false); setListTitle("Cuentas", ""); showDetailEmpty(); await renderAccounts(); break;
      case "import": setSplitView(false); setListTitle("Importar", ""); showDetailEmpty(); await renderImport(); break;
      case "settings": setSplitView(false); setListTitle("Configuración", ""); showDetailEmpty(); await renderSettings(); break;
    }
  } catch (e) {
    $("#listPanelBody").innerHTML = `<div class="empty-state">Error: ${e.message}</div>`;
  }
  showLoading(false);
}

async function initApp() {
  initTheme();
  loadStats();
  loadSidebarAccounts();
  if (typeof checkActiveImports === "function") checkActiveImports();
  navigate("inbox");
}

async function loadSidebarAccounts() {
  try {
    const tree = await api("/api/folders");
    renderSidebarAccounts(tree);
  } catch (e) {}
}

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const action = el.dataset.action;

  switch (action) {
    case "login": doLogin(); break;
    case "setup": doSetup(); break;
    case "nav": navigate(el.dataset.view); break;

    // Inbox
    case "show-email": showEmail(parseInt(el.dataset.emailId)); break;
    case "delete-email": deleteEmail(parseInt(el.dataset.emailId)); break;
    case "export-eml": downloadBlob(`/api/emails/${el.dataset.emailId}/export`, `email-${el.dataset.emailId}.eml`); break;
    case "export-mbox": exportMbox("/api/emails/export-mbox", "mailsilo-export.mbox"); break;
    case "export-mbox-search": exportMbox(`/api/emails/export-mbox?q=${encodeURIComponent(state.query)}`, "mailsilo-search-export.mbox"); break;
    case "show-folder":
      state.selectedEmailId = null;
      showFolder(el.dataset.accountEmail, el.dataset.folderName, parseInt(el.dataset.accountId));
      break;
    case "toggle-group": toggleFolderGroup(el.dataset.groupId); break;

    // Pagination
    case "change-folder-page": state.folder.page = parseInt(el.dataset.page); renderFolder(); break;
    case "do-search": doSearch(parseInt(el.dataset.page)); break;

    // Search
    case "search": doSearch(); break;

    // Accounts
    case "show-account": showAccountDetail(parseInt(el.dataset.accountId)); break;
    case "add-account": showProviderSelection(); break;
    case "edit-account": showEditAccount(parseInt(el.dataset.accountId)); break;
    case "delete-account": deleteAccount(parseInt(el.dataset.accountId)).catch(e => toast(`Error: ${e.message}`)); break;
    case "fetch": fetchAccount(parseInt(el.dataset.accountId)); break;
    case "cancel-fetch": cancelFetch(parseInt(el.dataset.accountId)); break;
    case "test-connection": testConnection(); break;
    case "fetch-all": fetchAllAccounts(); break;
    case "forward-email": forwardEmail(parseInt(el.dataset.emailId)); break;
    case "export-account-mbox": exportMbox(`/api/emails/export-mbox?account_id=${el.dataset.accountId}`, `mailsilo-${el.dataset.accountEmail || el.dataset.accountId}.mbox`); break;
    case "export-selected": exportSelectedMbox(); break;
    case "delete-selected": batchDeleteEmails(); break;
    case "delete-selected-accounts": batchDeleteAccounts().catch(e => toast(`Error: ${e.message}`)); break;

    case "close-modal": closeModal(); break;
    case "update-folders-input": updateFoldersInput(); break;
    case "logout":
      stopAllPollers();
      Object.keys(emailCache).forEach(k => delete emailCache[k]);
      AUTH_TOKEN = "";
      localStorage.removeItem("mailsilo_token");
      location.reload();
      break;
  }
});

document.addEventListener("submit", (e) => {
  const form = e.target;
  if (form.id === "accountForm") {
    const btn = form.querySelector("[data-action='save-account']");
    const id = parseInt(btn?.dataset?.accountId || "0");
    saveAccount(e, id);
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const topSearch = e.target.closest("#searchInputTop");
    if (topSearch) {
      state.query = topSearch.value.trim();
      navigate("search");
      return;
    }
    const input = e.target.closest("#searchInput");
    if (input) doSearch();
  }
  if (e.key === "Enter") {
    const loginInput = e.target.closest("#loginPassword");
    if (loginInput) doLogin();
    const setupInput = e.target.closest("#setupConfirm");
    if (setupInput) doSetup();
  }
});

// Sidebar nav click support
$$(".nav-item[data-view]").forEach(el => {
  el.addEventListener("click", (e) => {
    e.preventDefault();
    navigate(el.dataset.view);
  });
});

if (AUTH_TOKEN) {
  const lo = $("#logoutBtn");
  if (lo) lo.style.display = "flex";
} else {
  // Check if auth is disabled — hide logout if so
  fetch(API + "/api/auth/status").then(r => r.json()).then(s => {
    if (s.auth_enabled === false) {
      const lo = $("#logoutBtn");
      if (lo) lo.style.display = "none";
    }
  }).catch(() => {});
}

showLogin();
