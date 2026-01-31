import { createContext, useContext, createSignal, type JSX } from "solid-js"

interface ThemeContextValue {
  theme: () => "light" | "dark" | "system"
  setTheme: (theme: "light" | "dark" | "system") => void
  isDark: () => boolean
}

export const ThemeContext = createContext<ThemeContextValue>()

export function ThemeProvider(props: { children: JSX.Element }) {
  const [theme, setTheme] = createSignal<"light" | "dark" | "system">("system")

  const isDark = () => {
    const t = theme()
    if (t === "system") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches
    }
    return t === "dark"
  }

  return <ThemeContext.Provider value={{ theme, setTheme, isDark }}>{props.children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider")
  }
  return context
}
