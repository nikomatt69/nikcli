import { useColorScheme } from "nativewind"

export const palettes = {
  light: {
    background: "#f1f6fb",
    surface: "#ffffff",
    surfaceMuted: "#f6f9fc",
    surfaceRaised: "#ffffff",
    panel: "#e8f0f8",
    border: "#c1d0df",
    ink: "#0d1b2a",
    soft: "#46586e",
    muted: "#61768c",
    accent: "#0ea5e9",
    accentLight: "#0369a1",
    warn: "#d97706",
    warning: "#d97706",
    success: "#16a34a",
    danger: "#dc2626",
    critical: "#dc2626",
    focusRing: "rgba(14, 165, 233, 0.35)",
    shadowSoft: "rgba(15, 23, 42, 0.08)",
    shadowStrong: "rgba(15, 23, 42, 0.16)",
    tabBackground: "#f6f9fc",
    tabSurface: "#ffffff",
    tabStatus: "#edf3f8",
    shadow: "#94a3b8",
    codeBackground: "#dbeafe",
    codeText: "#0f172a",
    codeBlockBackground: "#1e1e1e",
    codeAccent: "#38bdf8",
    reasoningBackground: "#f4f8fc",
    userBubble: "#e0f3ff",
    assistantBubble: "#ffffff",
  },
  dark: {
    background: "#000000",
    surface: "#111111",
    surfaceMuted: "#171717",
    surfaceRaised: "#1d1d1d",
    panel: "#181818",
    border: "#262626",
    ink: "#f0f0f0",
    soft: "#b8b8b8",
    muted: "#7a7a7a",
    accent: "#e8e8e8",
    accentLight: "#ffffff",
    warn: "#fbbf24",
    warning: "#fbbf24",
    success: "#34d399",
    danger: "#fb7185",
    critical: "#fb7185",
    focusRing: "rgba(255, 255, 255, 0.26)",
    shadowSoft: "rgba(0, 0, 0, 0.32)",
    shadowStrong: "rgba(0, 0, 0, 0.52)",
    tabBackground: "#000000",
    tabSurface: "#111111",
    tabStatus: "#181818",
    shadow: "#000000",
    codeBackground: "#0f0f0f",
    codeText: "#e8e8e8",
    codeBlockBackground: "#1e1e1e",
    codeAccent: "#93c5fd",
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

export function useChatTheme() {
  const { colorScheme } = useColorScheme()
  const scheme = colorScheme === "light" ? "light" : "dark"
  return chatTokens[scheme]
}

// Chat UI Design Tokens - iOS 2026 Style
export const chatTokens = {
  light: {
    // Bubbles
    userBubbleBg: "#007AFF",
    userBubbleText: "#FFFFFF",
    userBubbleTail: "#007AFF",
    receivedBubbleBg: "#E9E9EB",
    receivedBubbleText: "#000000",
    receivedBubbleTail: "#E9E9EB",

    // Bubble styling
    bubbleRadius: 18,
    bubbleTailRadius: 4,
    bubbleMaxWidth: 0.75, // 75% screen width
    bubblePaddingH: 12,
    bubblePaddingV: 8,
    bubbleSpacing: 4,
    bubbleGroupSpacing: 16,

    // Input
    inputBg: "#F1F6FB",
    inputBorder: "#C1D0DF",
    inputFocusBorder: "#007AFF",
    inputPlaceholder: "#61768C",
    inputText: "#0D1B2A",
    inputSendActive: "#007AFF",
    inputSendDisabled: "#C1D0DF",

    // Status indicators
    statusOnline: "#34C759",
    statusOffline: "#8E8E93",
    statusBusy: "#FF9500",
    statusTyping: "#007AFF",

    // Read receipts
    readReceiptSent: "#8E8E93",
    readReceiptDelivered: "#8E8E93",
    readReceiptRead: "#007AFF",

    // Timestamps
    timestampColor: "#8E8E93",
    timestampFontSize: 11,

    // Avatar
    avatarBorder: "#FFFFFF",
    avatarOnline: "#34C759",
    avatarSize: 36,
    avatarRadius: 18,

    // List
    listSeparator: "#C1D0DF",
    listUnreadBg: "#F1F6FB",
    listUnreadDot: "#007AFF",

    // Reactions
    reactionBg: "#E5E5EA",
    reactionSelectedBg: "#007AFF",
    reactionSelectedText: "#FFFFFF",
    reactionBorder: "#FFFFFF",

    // Attachments
    attachmentBg: "#E9E9EB",
    attachmentIcon: "#8E8E93",

    // Voice message
    voiceWaveform: "#C7C7CC",
    voiceWaveformProgress: "#007AFF",
    voiceDuration: "#8E8E93",
  },
  dark: {
    // Bubbles
    userBubbleBg: "#0B84FF",
    userBubbleText: "#FFFFFF",
    userBubbleTail: "#0B84FF",
    receivedBubbleBg: "#2C2C2E",
    receivedBubbleText: "#FFFFFF",
    receivedBubbleTail: "#2C2C2E",

    // Bubble styling
    bubbleRadius: 18,
    bubbleTailRadius: 4,
    bubbleMaxWidth: 0.75,
    bubblePaddingH: 12,
    bubblePaddingV: 8,
    bubbleSpacing: 4,
    bubbleGroupSpacing: 16,

    // Input
    inputBg: "#1C1C1E",
    inputBorder: "#38383A",
    inputFocusBorder: "#0B84FF",
    inputPlaceholder: "#8E8E93",
    inputText: "#FFFFFF",
    inputSendActive: "#0B84FF",
    inputSendDisabled: "#38383A",

    // Status indicators
    statusOnline: "#30D158",
    statusOffline: "#636366",
    statusBusy: "#FF9F0A",
    statusTyping: "#0B84FF",

    // Read receipts
    readReceiptSent: "#636366",
    readReceiptDelivered: "#636366",
    readReceiptRead: "#0B84FF",

    // Timestamps
    timestampColor: "#8E8E93",
    timestampFontSize: 11,

    // Avatar
    avatarBorder: "#1C1C1E",
    avatarOnline: "#30D158",
    avatarSize: 36,
    avatarRadius: 18,

    // List
    listSeparator: "#38383A",
    listUnreadBg: "#1C1C1E",
    listUnreadDot: "#0B84FF",

    // Reactions
    reactionBg: "#3A3A3C",
    reactionSelectedBg: "#0B84FF",
    reactionSelectedText: "#FFFFFF",
    reactionBorder: "#1C1C1E",

    // Attachments
    attachmentBg: "#2C2C2E",
    attachmentIcon: "#8E8E93",

    // Voice message
    voiceWaveform: "#48484A",
    voiceWaveformProgress: "#0B84FF",
    voiceDuration: "#8E8E93",
  },
} as const

export type ChatTokens = (typeof chatTokens)[keyof typeof chatTokens]

// iOS 26 Animation tokens
export const chatAnimationTokens = {
  spring: {
    damping: 15,
    stiffness: 150,
    mass: 1,
  },
  bubble: {
    enter: 250,
    exit: 200,
  },
  typing: {
    dotDuration: 400,
    dotCount: 3,
  },
  scroll: {
    snapThreshold: 0.5,
  },
} as const
