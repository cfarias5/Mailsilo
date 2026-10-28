function openModal(html, opts = {}) {
  let overlay = $(".modal-overlay");
  const closable = opts.closable !== false;
  if (!overlay || !overlay.querySelector(".modal-body")) {
    if (overlay) overlay.remove();
    overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal"><div class="modal-body"></div></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay && closable) closeModal();
    });
  }
  overlay.querySelector(".modal-body").innerHTML = html;
  requestAnimationFrame(() => overlay.classList.add("show"));
}

function closeModal() {
  const overlay = $(".modal-overlay");
  if (overlay) {
    overlay.classList.remove("show");
    setTimeout(() => overlay.remove(), 200);
  }
}
