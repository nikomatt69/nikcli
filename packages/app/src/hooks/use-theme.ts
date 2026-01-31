import { useContext } from "solid-js"
import { ThemeContext } from "../context/theme"

export function useThemeHook() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error("useThemeHook must be used within ThemeProvider")
  }
  return context
}
