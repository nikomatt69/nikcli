import { RGBA, TextAttributes } from "@opentui/core"

export const theme = {
  bg: RGBA.fromHex("#080b10"),
  surface: RGBA.fromHex("#111821"),
  surfaceHover: RGBA.fromHex("#172131"),
  surfaceActive: RGBA.fromHex("#203044"),
  surfaceRaised: RGBA.fromHex("#16202c"),
  border: RGBA.fromHex("#263344"),
  borderSubtle: RGBA.fromHex("#1a2532"),
  borderFocus: RGBA.fromHex("#6bb8ff"),
  text: RGBA.fromHex("#edf4fb"),
  textSecondary: RGBA.fromHex("#b9c7d6"),
  textMuted: RGBA.fromHex("#6f7f90"),
  accent: RGBA.fromHex("#52d273"),
  accentDim: RGBA.fromHex("#2daa53"),
  success: RGBA.fromHex("#52d273"),
  warning: RGBA.fromHex("#e6b450"),
  error: RGBA.fromHex("#ff6b6b"),
  info: RGBA.fromHex("#6bb8ff"),
  blue: RGBA.fromHex("#6bb8ff"),
  blueDim: RGBA.fromHex("#3178c6"),
  yellow: RGBA.fromHex("#e6b450"),
  red: RGBA.fromHex("#ff6b6b"),
  redDim: RGBA.fromHex("#d94c4c"),
  purple: RGBA.fromHex("#c8a7ff"),
  cyan: RGBA.fromHex("#55d6be"),
  orange: RGBA.fromHex("#ff9f4a"),
  pink: RGBA.fromHex("#ff8cc6"),
  chart1: RGBA.fromHex("#52d273"),
  chart2: RGBA.fromHex("#6bb8ff"),
  chart3: RGBA.fromHex("#e6b450"),
  chart4: RGBA.fromHex("#ff6b6b"),
  chart5: RGBA.fromHex("#c8a7ff"),
  chart6: RGBA.fromHex("#55d6be"),
  deltaFaster: RGBA.fromHex("#52d273"),
  deltaSlower: RGBA.fromHex("#ff6b6b"),
  deltaNeutral: RGBA.fromHex("#6f7f90"),
  scrollbar: RGBA.fromHex("#1a2532"),
  scrollbarThumb: RGBA.fromHex("#52657a"),
  overlay: RGBA.fromHex("#000000"),
}

export const glyph = {
  active: "▸",
  idle: " ",
  pass: "✓",
  fail: "✗",
  running: "●",
  skip: "○",
  todo: "◇",
  mixed: "◔",
  notRun: "·",
  up: "↑",
  down: "↓",
  stable: "→",
  expand: "▾",
  collapse: "▸",
  divider: "─",
  star: "★",
  warning: "⚠",
}

export function valueTrendColor(t: "up" | "down" | "stable"): RGBA {
  return t === "up" ? theme.deltaFaster : t === "down" ? theme.deltaSlower : theme.deltaNeutral
}

export function deltaColor(pct: number): RGBA {
  const abs = Math.abs(pct)
  if (abs < 0.5) return theme.deltaNeutral
  if (abs < 2) return pct < 0 ? theme.accentDim : theme.orange
  if (abs < 5) return pct < 0 ? theme.accent : theme.redDim
  return pct < 0 ? theme.accent : theme.error
}

export function severityColor(severity: string): RGBA {
  switch (severity) {
    case "critical":
      return theme.error
    case "regression":
      return theme.red
    case "improvement":
      return theme.success
    case "error":
      return theme.red
    case "warning":
      return theme.warning
    default:
      return theme.info
  }
}

export function suiteExecColor(status: string): RGBA {
  switch (status) {
    case "pass":
      return theme.success
    case "fail":
      return theme.error
    case "running":
      return theme.warning
    case "skip":
      return theme.textMuted
    case "todo":
      return theme.purple
    case "mixed":
      return theme.orange
    default:
      return theme.textMuted
  }
}

export function stateColor(state: string): RGBA {
  switch (state) {
    case "running":
      return theme.warning
    case "success":
      return theme.success
    case "error":
      return theme.error
    default:
      return theme.textMuted
  }
}

export function stateIcon(state: string): string {
  switch (state) {
    case "running":
      return "\u25cf"
    case "success":
      return "\u2713"
    case "error":
      return "\u2717"
    default:
      return "\u25cb"
  }
}

export const typography = {
  title: TextAttributes.BOLD,
  subtitle: TextAttributes.NONE,
  label: TextAttributes.BOLD,
  mono: TextAttributes.NONE,
  highlight: TextAttributes.BOLD,
  dim: TextAttributes.NONE,
}

export function deltaBar(pct: number, width = 8): string {
  const abs = Math.abs(pct)
  const filled = Math.min(width, Math.max(0, Math.round(abs / 2)))
  const dir = pct < 0 ? glyph.down : glyph.up
  if (abs < 0.5) return glyph.stable + "░".repeat(width - 1)
  return dir + "█".repeat(filled) + "░".repeat(Math.max(0, width - filled))
}

export function progressBar(current: number, total: number, width = 10): string {
  if (total <= 0) return "░".repeat(width)
  const filled = Math.min(width, Math.max(0, Math.round((current / total) * width)))
  return "█".repeat(filled) + "░".repeat(width - filled)
}

export function ratioBar(rate: number, width = 20): string {
  const clamped = Math.min(1, Math.max(0, rate))
  const filled = Math.round(clamped * width)
  return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled))
}

export function truncateMiddle(value: string, max = 18): string {
  if (value.length <= max) return value
  if (max <= 3) return value.slice(0, max)
  const left = Math.ceil((max - 1) / 2)
  const right = Math.floor((max - 1) / 2)
  return `${value.slice(0, left)}…${value.slice(-right)}`
}

export function sparklineChars(values: number[], width = 20): string {
  if (values.length < 2) return ""
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const blocks = ["\u2581", "\u2582", "\u2583", "\u2584", "\u2585", "\u2586", "\u2587", "\u2588"]
  const step = Math.max(1, Math.floor(values.length / width))
  const sampled = values.filter((_, i) => i % step === 0).slice(0, width)
  return sampled.map((v) => blocks[Math.round(((v - min) / range) * 7)]).join("")
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}
