import { createContext, useContext, useEffect, useState, useCallback } from "react"
import { Appearance, ColorSchemeName } from "react-native"
import { Provider as PaperProvider } from "react-native-paper"
import type { PropsWithChildren } from "react"
import { useSettingsStore } from "../stores"

interface ThemeContextType {
  colorScheme: ColorSchemeName
  setColorScheme: (scheme: ColorSchemeName) => void
}

const ThemeContext = createContext<ThemeContextType | null>(null)

export function useThemeContext() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error("useThemeContext must be used within ThemeProvider")
  }
  return context
}

export function ThemeProvider({ children }: PropsWithChildren) {
  const settingsStore = useSettingsStore()
  const [colorScheme, setColorScheme] = useState<ColorSchemeName>(Appearance.getColorScheme())

  useEffect(() => {
    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      if (settingsStore.theme === "system") {
        setColorScheme(colorScheme)
      }
    })

    return () => subscription.remove()
  }, [settingsStore.theme])

  useEffect(() => {
    if (settingsStore.theme !== "system") {
      setColorScheme(settingsStore.theme)
    }
  }, [settingsStore.theme])

  const value: ThemeContextType = {
    colorScheme,
    setColorScheme: (scheme: ColorSchemeName) => {
      const themeValue = scheme ?? "system"
      settingsStore.setTheme(themeValue)
      setColorScheme(scheme)
    },
  }

  const paperTheme = {
    dark: colorScheme === "dark",
    mode: "exact" as const,
    roundness: 12,
    colors: {
      primary: "#6366f1",
      onPrimary: "#ffffff",
      primaryContainer: "#e0e1ff",
      onPrimaryContainer: "#090a5a",
      secondary: "#5c5d72",
      onSecondary: "#ffffff",
      secondaryContainer: "#e1e0f9",
      onSecondaryContainer: "#191a2c",
      tertiary: "#78536b",
      onTertiary: "#ffffff",
      tertiaryContainer: "#ffd8e4",
      onTertiaryContainer: "#2e1126",
      error: "#ba1a1a",
      onError: "#ffffff",
      errorContainer: "#ffdad6",
      onErrorContainer: "#410002",
      background: colorScheme === "dark" ? "#1a1a2e" : "#fefbff",
      onBackground: colorScheme === "dark" ? "#e5e1e6" : "#1a1c20",
      surface: colorScheme === "dark" ? "#1a1a2e" : "#fefbff",
      onSurface: colorScheme === "dark" ? "#e5e1e6" : "#1a1c20",
      surfaceVariant: colorScheme === "dark" ? "#46464f" : "#e4e1ec",
      onSurfaceVariant: colorScheme === "dark" ? "#c6c5d0" : "#45464f",
      outline: colorScheme === "dark" ? "#90909a" : "#757780",
      outlineVariant: colorScheme === "dark" ? "#46464f" : "#c4c6d0",
      inverseSurface: colorScheme === "dark" ? "#e5e1e6" : "#2f3036",
      inverseOnSurface: colorScheme === "dark" ? "#2f3036" : "#f1f0f4",
      inversePrimary: "#bec1ff",
      scrim: "#000000",
      shadow: "#000000",
    },
  }

  return (
    <ThemeContext.Provider value={value}>
      <PaperProvider theme={paperTheme}>{children}</PaperProvider>
    </ThemeContext.Provider>
  )
}
