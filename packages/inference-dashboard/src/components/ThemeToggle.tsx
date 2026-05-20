import { createSignal, onMount } from "solid-js"

export default function ThemeToggle() {
  const [theme, setTheme] = createSignal<"light" | "dark">("dark")

  onMount(() => {
    const saved = localStorage.getItem("theme") as "light" | "dark" | null
    if (saved) {
      setTheme(saved)
      document.documentElement.setAttribute("data-theme", saved)
    } else {
      // Check system preference
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
      const initial = prefersDark ? "dark" : "light"
      setTheme(initial)
      document.documentElement.setAttribute("data-theme", initial)
    }
  })

  function toggle() {
    const next = theme() === "dark" ? "light" : "dark"
    setTheme(next)
    localStorage.setItem("theme", next)
    document.documentElement.setAttribute("data-theme", next)
  }

  return (
    <button
      onClick={toggle}
      class="flex items-center justify-center rounded-full border border-terminal-border/50 bg-terminal-panel/70 text-terminal-muted transition-all duration-150 hover:border-terminal-accent/40 hover:text-terminal-accent hover:bg-terminal-accent/8 active:scale-[0.94]"
      title={`Switch to ${theme() === "dark" ? "light" : "dark"} mode`}
      aria-label={`Switch to ${theme() === "dark" ? "light" : "dark"} mode`}
      aria-pressed={theme() === "dark" ? "true" : "false"}
    >
      {theme() === "dark" ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        </svg>
      )}
    </button>
  )
}
