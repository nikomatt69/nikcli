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

// Glass-specific tokens for expo-glass-effect
export const glassTokens = {
  light: {
    // Shell: subtle glass fill for headers, tabs, overlays
    glassShell: "rgba(255, 255, 255, 0.72)",
    glassShellStrong: "rgba(255, 255, 255, 0.85)",
    // Panel: stronger glass for cards, sheets
    glassPanel: "rgba(232, 240, 248, 0.68)",
    glassPanelStrong: "rgba(232, 240, 248, 0.82)",
    // Border: white borders for glass separation
    glassBorder: "rgba(255, 255, 255, 0.18)",
    glassBorderStrong: "rgba(255, 255, 255, 0.28)",
    // Shadow: light-mode glass shadow
    glassShadow: "rgba(0, 0, 0, 0.06)",
    glassShadowStrong: "rgba(0, 0, 0, 0.1)",
    // Scrim: background tint for overlays
    glassScrim: "rgba(0, 0, 0, 0.025)",
    // Accent tint: subtle color for interactive glass
    glassTintAccent: "rgba(14, 165, 233, 0.08)",
    glassTintAccentStrong: "rgba(14, 165, 233, 0.15)",
  },
  dark: {
    // Shell: subtle glass fill for headers, tabs, overlays
    glassShell: "rgba(13, 27, 42, 0.72)",
    glassShellStrong: "rgba(13, 27, 42, 0.85)",
    // Panel: stronger glass for cards, sheets
    glassPanel: "rgba(18, 38, 58, 0.68)",
    glassPanelStrong: "rgba(18, 38, 58, 0.82)",
    // Border: white borders for glass separation
    glassBorder: "rgba(255, 255, 255, 0.1)",
    glassBorderStrong: "rgba(255, 255, 255, 0.18)",
    // Shadow: dark-mode glass shadow
    glassShadow: "rgba(0, 0, 0, 0.3)",
    glassShadowStrong: "rgba(0, 0, 0, 0.45)",
    // Scrim: background tint for overlays
    glassScrim: "rgba(0, 0, 0, 0.18)",
    // Accent tint: subtle color for interactive glass
    glassTintAccent: "rgba(56, 189, 248, 0.1)",
    glassTintAccentStrong: "rgba(56, 189, 248, 0.18)",
  },
} as const

export type GlassTokens = (typeof glassTokens)[keyof typeof glassTokens]

export function useAppTheme() {
  const { colorScheme } = useColorScheme()
  const scheme = colorScheme === "light" ? "light" : "dark"
  return {
    colorScheme: scheme,
    isDark: scheme === "dark",
    palette: palettes[scheme],
    glass: glassTokens[scheme],
  }
}
