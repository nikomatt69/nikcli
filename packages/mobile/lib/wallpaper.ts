import type { WallpaperPreferences } from "./types"

export const DEFAULT_WALLPAPER: WallpaperPreferences = {
  uri: null,
  opacity: 0.22,
  enabled: false,
}

export function normalizeWallpaper(value: unknown): WallpaperPreferences {
  if (!value || typeof value !== "object") return { ...DEFAULT_WALLPAPER }
  const raw = value as Record<string, unknown>
  const opacity =
    typeof raw.opacity === "number" && Number.isFinite(raw.opacity) ? raw.opacity : DEFAULT_WALLPAPER.opacity
  return {
    uri: typeof raw.uri === "string" && raw.uri.trim() ? raw.uri : null,
    opacity: Math.min(0.6, Math.max(0.08, opacity)),
    enabled: raw.enabled === true,
  }
}
