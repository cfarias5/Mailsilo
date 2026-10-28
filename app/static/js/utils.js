let AUTH_TOKEN = localStorage.getItem("mailsilo_token") || "";

function $(sel, ctx) { return (ctx || document).querySelector(sel); }
function $$(sel, ctx) { return [...(ctx || document).querySelectorAll(sel)]; }

function esc(s) {
  if (s == null) return "";
  const d = document.createElement("div");
  d.textContent = String(s);
  return d.innerHTML;
}

function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function showLoading(show = true) {
  const el = $("#listPanelBody");
  if (!el) return;
  if (show) {
    el.innerHTML = `
      <div class="skeleton-card">
        <div class="skeleton skeleton-avatar"></div>
        <div style="flex:1">
          <div class="skeleton skeleton-line short"></div>
          <div class="skeleton skeleton-line"></div>
          <div class="skeleton skeleton-line medium"></div>
        </div>
      </div>
      <div class="skeleton-card">
        <div class="skeleton skeleton-avatar"></div>
        <div style="flex:1">
          <div class="skeleton skeleton-line short"></div>
          <div class="skeleton skeleton-line"></div>
          <div class="skeleton skeleton-line medium"></div>
        </div>
      </div>
      <div class="skeleton-card">
        <div class="skeleton skeleton-avatar"></div>
        <div style="flex:1">
          <div class="skeleton skeleton-line short"></div>
          <div class="skeleton skeleton-line"></div>
          <div class="skeleton skeleton-line medium"></div>
        </div>
      </div>`;
  }
}

function isImageType(ct) {
  return ct && ct.startsWith("image/");
}

const emailCache = {};
const MAX_CACHE = 100;

function cacheSet(id, data) {
  const keys = Object.keys(emailCache);
  if (keys.length >= MAX_CACHE) delete emailCache[keys[0]];
  emailCache[id] = data;
}

function downloadBlob(url, filename) {
  fetch(url, { headers: authHeaders() })
    .then(r => { if (!r.ok) throw new Error("Download failed"); return r.blob(); })
    .then(blob => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    })
    .catch(() => toast("Download error"));
}

function exportMbox(url, filename) {
  openModal(`<div style="text-align:center;min-width:280px">
    <div style="font-size:2.5rem;margin-bottom:.5rem">📦</div>
    <h3 style="margin-bottom:.25rem;font-size:1rem">Exporting MBOX...</h3>
    <p style="font-size:.82rem;color:var(--text-tertiary);margin-top:.5rem">Generating file, this may take a few seconds</p>
    <div class="import-progress-bar" style="margin:.75rem 0">
      <div class="import-progress-bar-fill" style="width:100%;animation:pulse 1.5s infinite"></div>
    </div>
  </div>`);
  // Prevent overlay close
  const ov = $(".modal-overlay");
  if (ov) {
    const cl = ov.cloneNode(true);
    ov.parentNode.replaceChild(cl, ov);
  }
  fetch(url, { headers: authHeaders() })
    .then(r => {
      if (!r.ok) throw new Error("Export error");
      return r.blob();
    })
    .then(blob => {
      closeModal();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      toast("✅ Export complete");
    })
    .catch(e => {
      const st = $("#exportMboxStatus");
      if (st) st.innerHTML = `<span style="color:var(--danger)">❌ ${e.message}</span>`;
      setTimeout(() => closeModal(), 2000);
    });
}

function exportSelectedMbox() {
  const ids = [...selectedIds];
  if (!ids.length) { toast("Select at least one email"); return; }
  exportMbox(`/api/emails/export-mbox-by-ids?ids=${ids.join(",")}`, `mailsilo-export-${ids.length}emails.mbox`);
}

function pagination(total, page, perPage, fn) {
  const pages = Math.ceil(total / perPage);
  if (pages <= 1) return "";
  let html = `<div class="pagination">`;
  const range = (lo, hi) => { for (let i = lo; i <= hi; i++) html += btn(i); };
  const btn = (i) => { const a = i === page ? "active" : ""; return `<button class="${a}" data-action="${fn}" data-page="${i}">${i}</button>`; };
  const dot = () => { html += `<span class="pagi-dots">…</span>`; };
  if (pages <= 7) {
    range(1, pages);
  } else {
    range(1, 2);
    if (page > 4) dot();
    range(Math.max(3, page - 1), Math.min(pages - 2, page + 1));
    if (page < pages - 3) dot();
    range(pages - 1, pages);
  }
  return html + "</div>";
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const v = (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0);
  return v + " " + units[i];
}
