import { RGBA, TextAttributes } from "@opentui/core"

export const theme = {
  bg: RGBA.fromHex("#0d1117"),
  surface: RGBA.fromHex("#151b23"),
  surfaceHover: RGBA.fromHex("#1c2333"),
  surfaceActive: RGBA.fromHex("#21262d"),
  border: RGBA.fromHex("#30363d"),
  borderFocus: RGBA.fromHex("#58a6ff"),
  text: RGBA.fromHex("#e6edf3"),
  textSecondary: RGBA.fromHex("#c9d1d9"),
  textMuted: RGBA.fromHex("#7d8590"),
  accent: RGBA.fromHex("#3fb950"),
  accentDim: RGBA.fromHex("#2ea043"),
  success: RGBA.fromHex("#3fb950"),
  warning: RGBA.fromHex("#d29922"),
  error: RGBA.fromHex("#f85149"),
  info: RGBA.fromHex("#58a6ff"),
  blue: RGBA.fromHex("#58a6ff"),
  blueDim: RGBA.fromHex("#1f6feb"),
  yellow: RGBA.fromHex("#d29922"),
  red: RGBA.fromHex("#f85149"),
  redDim: RGBA.fromHex("#da3633"),
  purple: RGBA.fromHex("#bc8cff"),
  cyan: RGBA.fromHex("#39d2c0"),
  orange: RGBA.fromHex("#f0883e"),
  pink: RGBA.fromHex("#f778ba"),
  chart1: RGBA.fromHex("#3fb950"),
  chart2: RGBA.fromHex("#58a6ff"),
  chart3: RGBA.fromHex("#d29922"),
  chart4: RGBA.fromHex("#f85149"),
  chart5: RGBA.fromHex("#bc8cff"),
  chart6: RGBA.fromHex("#39d2c0"),
  deltaFaster: RGBA.fromHex("#3fb950"),
  deltaSlower: RGBA.fromHex("#f85149"),
  deltaNeutral: RGBA.fromHex("#7d8590"),
  scrollbar: RGBA.fromHex("#21262d"),
  scrollbarThumb: RGBA.fromHex("#484f58"),
  overlay: RGBA.fromHex("#000000"),
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
    case "critical": return theme.error
    case "error": return theme.red
    case "warning": return theme.warning
    default: return theme.info
  }
}

export function stateColor(state: string): RGBA {
  switch (state) {
    case "running": return theme.warning
    case "success": return theme.success
    case "error": return theme.error
    default: return theme.textMuted
  }
}

export function stateIcon(state: string): string {
  switch (state) {
    case "running": return "\u25cf"
    case "success": return "\u2713"
    case "error": return "\u2717"
    default: return "\u25cb"
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
  const filled = Math.min(width, Math.max(0, Math.round(Math.abs(pct) / 3)))
  const dir = pct < 0 ? "\u2190" : "\u2192"
  if (abs < 0.5) return "~" + "\u00b7".repeat(width - 1)
  return dir + "\u2588".repeat(filled) + "\u00b7".repeat(Math.max(0, width - filled))
}

export function progressBar(current: number, total: number, width = 10): string {
  if (total <= 0) return "\u00b7".repeat(width)
  const filled = Math.min(width, Math.max(0, Math.round((current / total) * width)))
  return "\u2588".repeat(filled) + "\u00b7".repeat(width - filled)
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
