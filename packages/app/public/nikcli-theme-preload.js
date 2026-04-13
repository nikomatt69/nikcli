;(function () {
  var themeId = localStorage.getItem("nikcli-theme-id")
  if (!themeId) return

  var scheme = localStorage.getItem("nikcli-color-scheme") || "system"
  var isDark = scheme === "dark" || (scheme === "system" && matchMedia("(prefers-color-scheme: dark)").matches)
  var mode = isDark ? "dark" : "light"

  document.documentElement.dataset.theme = themeId
  document.documentElement.dataset.colorScheme = mode

  if (themeId === "nikcli-default") return

  var css = localStorage.getItem("nikcli-theme-css-" + mode)
  if (css) {
    var style = document.createElement("style")
    style.id = "nikcli-theme-preload"
    style.textContent =
      ":root{color-scheme:" +
      mode +
      ";--text-mix-blend-mode:" +
      (isDark ? "plus-lighter" : "multiply") +
      ";" +
      css +
      "}"
    document.head.appendChild(style)
  }
})()
