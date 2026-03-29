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
    codeBlockBackground: "#1e1e1e",
    reasoningBackground: "#f4f8fc",
    userBubble: "#e0f3ff",
    assistantBubble: "#ffffff",
  },
  dark: {
    background: "#000000",
    surface: "#111111",
    panel: "#181818",
    border: "#262626",
    ink: "#f0f0f0",
    soft: "#b8b8b8",
    muted: "#7a7a7a",
    accent: "#e8e8e8",
    accentLight: "#ffffff",
    warn: "#b7b7b7",
    success: "#d4d4d4",
    danger: "#8f8f8f",
    tabBackground: "#000000",
    tabSurface: "#111111",
    tabStatus: "#181818",
    shadow: "#000000",
    codeBackground: "#0f0f0f",
    codeText: "#e8e8e8",
    codeBlockBackground: "#1e1e1e",
    reasoningBackground: "#181818",
    userBubble: "#262626",
    assistantBubble: "#171717",
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
    glassShell: "rgba(17, 17, 17, 0.72)",
    glassShellStrong: "rgba(17, 17, 17, 0.85)",
    // Panel: stronger glass for cards, sheets
    glassPanel: "rgba(24, 24, 24, 0.68)",
    glassPanelStrong: "rgba(24, 24, 24, 0.82)",
    // Border: white borders for glass separation
    glassBorder: "rgba(255, 255, 255, 0.1)",
    glassBorderStrong: "rgba(255, 255, 255, 0.18)",
    // Shadow: dark-mode glass shadow
    glassShadow: "rgba(0, 0, 0, 0.3)",
    glassShadowStrong: "rgba(0, 0, 0, 0.45)",
    // Scrim: background tint for overlays
    glassScrim: "rgba(0, 0, 0, 0.18)",
    // Accent tint: subtle color for interactive glass
    glassTintAccent: "rgba(255, 255, 255, 0.08)",
    glassTintAccentStrong: "rgba(255, 255, 255, 0.14)",
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
