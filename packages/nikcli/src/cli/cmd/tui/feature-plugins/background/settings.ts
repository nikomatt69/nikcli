/**
 * Settings for the background-image plugin.
 *
 * Everything lives in the TUI key-value store (`Global.Path.state/kv.json`)
 * rather than in `nikcli.json`: the image is a personal, per-machine choice
 * and `/background` edits it live, so a config round-trip would be noise in
 * a shared repo.
 */
import os from "os"
import path from "path"

export type BackgroundFit = "cover" | "contain"

/** Where the image is painted: only the home splash, or every route. */
export type BackgroundScope = "home" | "all"

export type BackgroundSettings = {
  /** Absolute path, directory, `file://`, `http(s)://` or `data:` URL. Empty when unset. */
  source: string
  enabled: boolean
  /** How strongly the image shows through the theme background (0..1). */
  opacity: number
  fit: BackgroundFit
  scope: BackgroundScope
  grayscale: boolean
}

export const BACKGROUND_KV_KEY = "background_image"

export const DEFAULT_SETTINGS: BackgroundSettings = {
  source: "",
  enabled: true,
  opacity: 0.3,
  fit: "cover",
  // Behind every route, sessions included — a wallpaper that vanishes the
  // moment you open a session reads as a bug. `/background` can still scope it
  // back to the home splash.
  scope: "all",
  grayscale: false,
}

export const OPACITY_MIN = 0.05
export const OPACITY_MAX = 0.9
export const OPACITY_STEP = 0.05

export const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff"]

const round = (value: number) => Math.round(value * 100) / 100

export function clampOpacity(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_SETTINGS.opacity
  return round(Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, value)))
}

/** Cycle the opacity by one step, wrapping around at the ends. */
export function stepOpacity(value: number, direction: 1 | -1 = 1) {
  const next = round(clampOpacity(value) + direction * OPACITY_STEP)
  if (next > OPACITY_MAX) return OPACITY_MIN
  if (next < OPACITY_MIN) return OPACITY_MAX
  return next
}

export function isImagePath(value: string) {
  const lower = value.toLowerCase().split(/[?#]/)[0] ?? ""
  return IMAGE_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

/**
 * Normalize whatever a terminal hands us when a file is dropped onto the
 * prompt: surrounding quotes, backslash-escaped spaces, a `~` home prefix.
 *
 * The backslash unescape is POSIX-only. On Windows `\` is the path separator,
 * so stripping it would turn `C:\Users\me\a.png` into `C:Usersmea.png` —
 * quoting, not escaping, is how cmd/PowerShell pass a path with spaces.
 */
export function cleanSource(input: string, home = os.homedir(), windows = process.platform === "win32") {
  let value = input.trim()
  if (value.length === 0) return ""
  const quote = value[0]
  if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length > 1) {
    value = value.slice(1, -1)
  }
  if (!windows) value = value.replace(/\\(.)/g, "$1")
  value = value.trim()
  if (value === "~") return home
  if (value.startsWith("~/") || (windows && value.startsWith("~\\"))) return path.join(home, value.slice(2))
  return value
}

function pickString<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

export function normalize(value: unknown): BackgroundSettings {
  if (typeof value === "string") {
    return { ...DEFAULT_SETTINGS, source: cleanSource(value) }
  }
  if (!value || typeof value !== "object") return { ...DEFAULT_SETTINGS }
  const record = value as Record<string, unknown>
  return {
    source: typeof record.source === "string" ? cleanSource(record.source) : DEFAULT_SETTINGS.source,
    enabled: typeof record.enabled === "boolean" ? record.enabled : DEFAULT_SETTINGS.enabled,
    opacity: typeof record.opacity === "number" ? clampOpacity(record.opacity) : DEFAULT_SETTINGS.opacity,
    fit: pickString(record.fit, ["cover", "contain"] as const, DEFAULT_SETTINGS.fit),
    scope: pickString(record.scope, ["home", "all"] as const, DEFAULT_SETTINGS.scope),
    grayscale: typeof record.grayscale === "boolean" ? record.grayscale : DEFAULT_SETTINGS.grayscale,
  }
}

export function opacityLabel(value: number) {
  return `${Math.round(clampOpacity(value) * 100)}%`
}

/** Short, human-readable form of the source for dialog rows. */
export function sourceLabel(source: string) {
  if (!source) return "none"
  if (source.startsWith("data:")) return "attached image"
  if (/^https?:\/\//.test(source)) return source
  return path.basename(source) || source
}
