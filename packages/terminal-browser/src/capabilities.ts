import type { BitmapProtocol, TerminalCapabilities, TerminalColorMode } from "./types"

function detectColorMode(env: NodeJS.ProcessEnv): TerminalColorMode {
  const colorTerm = env.COLORTERM?.toLowerCase() ?? ""
  const term = env.TERM?.toLowerCase() ?? ""

  if (colorTerm.includes("truecolor") || colorTerm.includes("24bit")) return "truecolor"
  if (term.includes("direct") || term.includes("truecolor")) return "truecolor"
  if (term.includes("256color")) return "ansi256"
  return "mono"
}

function detectBitmapProtocol(env: NodeJS.ProcessEnv): BitmapProtocol {
  const term = env.TERM?.toLowerCase() ?? ""
  const termProgram = env.TERM_PROGRAM?.toLowerCase() ?? ""

  if (term.includes("kitty")) return "kitty"
  if (termProgram.includes("iterm")) return "iterm"
  if (env.LC_TERMINAL?.toLowerCase().includes("iterm")) return "iterm"
  if (env.KONSOLE_VERSION && env.TERM?.toLowerCase().includes("sixel")) return "sixel"
  return "none"
}

export function detectTerminalCapabilities(env: NodeJS.ProcessEnv = process.env): TerminalCapabilities {
  const colorMode = detectColorMode(env)
  const bitmapProtocol = detectBitmapProtocol(env)

  return {
    colorMode,
    trueColor: colorMode === "truecolor",
    supportsUnicodeBlocks: env.LANG?.toLowerCase().includes("utf") !== false,
    bitmapProtocol,
    supportsBitmap: bitmapProtocol !== "none",
    term: env.TERM ?? "",
    termProgram: env.TERM_PROGRAM ?? "",
  }
}

export function normalizeWebUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim()
  if (!trimmed) return ""
  if (/^(https?|file):\/\//i.test(trimmed)) return trimmed
  if (/^about:/i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

export function clampTerminalViewport(columns: number, rows: number) {
  return {
    columns: Math.max(1, Math.floor(columns)),
    rows: Math.max(1, Math.floor(rows)),
  }
}

export function browserViewportFromTerminal(columns: number, rows: number) {
  const viewport = clampTerminalViewport(columns, rows)
  return {
    ...viewport,
    pixelWidth: Math.max(320, viewport.columns * 8),
    pixelHeight: Math.max(240, viewport.rows * 16),
  }
}
