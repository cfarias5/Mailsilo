const THEME_KEY = "mailsilo_theme";

function getAutoTheme() {
  const h = new Date().getHours();
  return h >= 7 && h < 19 ? "light" : "dark";
}

function getSavedTheme() {
  return localStorage.getItem(THEME_KEY) || "auto";
}

function logoThemeSrc() {
  return document.body.classList.contains("light")
    ? "/static/logo-light.png"
    : "/static/logo-dark.png";
}

function updateLogo() {
  document.querySelectorAll('img[alt="MailSilo"]').forEach(img => {
    img.src = logoThemeSrc();
  });
}

function applyTheme(mode) {
  const theme = mode === "auto" ? getAutoTheme() : mode;
  document.body.classList.toggle("light", theme === "light");
  updateLogo();
}

function setTheme(mode) {
  localStorage.setItem(THEME_KEY, mode);
  applyTheme(mode);
}

function initTheme() {
  applyTheme(getSavedTheme());
  if (getSavedTheme() === "auto") {
    const next = () => {
      const now = new Date();
      const msUntilNext = (() => {
        const h = now.getHours();
        let targetH;
        if (h >= 7 && h < 19) targetH = 19;
        else targetH = 7;
        const target = new Date(now);
        target.setHours(targetH, 0, 0, 0);
        if (target <= now) target.setDate(target.getDate() + 1);
        return target.getTime() - now.getTime();
      })();
      setTimeout(() => { applyTheme("auto"); next(); }, msUntilNext);
    };
    next();
  }
}
