(() => {
  const key = "relay-theme";
  const root = document.documentElement;
  const system = matchMedia("(prefers-color-scheme: dark)");
  let preference = null;
  try {
    const saved = localStorage.getItem(key);
    if (saved === "light" || saved === "dark") preference = saved;
  } catch {
    // Theme switching still works when browser storage is unavailable.
  }
  const apply = () => {
    const theme = preference || (system.matches ? "dark" : "light");
    root.dataset.theme = theme;
    for (const button of document.querySelectorAll("[data-theme-toggle]")) {
      button.textContent = theme === "light" ? "☀ Light" : "☾ Dark";
      button.setAttribute(
        "aria-label",
        `Switch to ${theme === "light" ? "dark" : "light"} theme`,
      );
      button.title = button.getAttribute("aria-label");
      button.setAttribute("aria-pressed", String(theme === "light"));
    }
    window.dispatchEvent(
      new CustomEvent("relay:themechange", { detail: { theme } }),
    );
  };
  apply();
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      apply();
      for (const button of document.querySelectorAll("[data-theme-toggle]")) {
        button.addEventListener("click", () => {
          preference = root.dataset.theme === "light" ? "dark" : "light";
          try {
            localStorage.setItem(key, preference);
          } catch {}
          apply();
        });
      }
    },
    { once: true },
  );
  system.addEventListener("change", () => {
    if (!preference) apply();
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== key && event.key !== null) return;
    preference =
      event.newValue === "light" || event.newValue === "dark"
        ? event.newValue
        : null;
    apply();
  });
})();
