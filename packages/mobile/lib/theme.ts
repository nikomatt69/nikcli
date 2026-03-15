import { useColorScheme } from "nativewind"

export const palettes = {
  light: {
    background: "#f1f6fb",
    surface: "#ffffff",
    panel: "#e8f0f8",
    border: "#c1d0df",
    ink: "#0d1b2a",
    soft: "#46586e",
    muted: "#61768c",
    accent: "#0ea5e9",
    accentLight: "#0369a1",
    warn: "#d97706",
    success: "#16a34a",
    danger: "#dc2626",
    tabBackground: "#f6f9fc",
    tabSurface: "#ffffff",
    tabStatus: "#edf3f8",
    shadow: "#94a3b8",
    codeBackground: "#dbeafe",
    codeText: "#0f172a",
    reasoningBackground: "#f4f8fc",
    userBubble: "#e0f3ff",
    assistantBubble: "#ffffff",
  },
  dark: {
    background: "#06121f",
    surface: "#0d1b2a",
    panel: "#12263a",
    border: "#1d344d",
    ink: "#e6eef8",
    soft: "#94a8bd",
    muted: "#89a3bf",
    accent: "#38bdf8",
    accentLight: "#7dd3fc",
    warn: "#f59e0b",
    success: "#22c55e",
    danger: "#ef4444",
    tabBackground: "#06121f",
    tabSurface: "#071523",
    tabStatus: "#081728",
    shadow: "#020617",
    codeBackground: "#071321",
    codeText: "#d8e5f2",
    reasoningBackground: "#0b1a29",
    userBubble: "#11324d",
    assistantBubble: "#0c1826",
  },
} as const

export type AppPalette = (typeof palettes)[keyof typeof palettes]

export function useAppTheme() {
  const { colorScheme } = useColorScheme()
  const scheme = colorScheme === "light" ? "light" : "dark"
  return {
    colorScheme: scheme,
    isDark: scheme === "dark",
    palette: palettes[scheme],
  }
}
