/**
 * nikcli pixel wordmark assets.
 *
 * Naming follows surface contrast, not appearance mode:
 * - `wordmark-dark`  → pale letters for dark / photographic surfaces
 * - `wordmark-light` → ink letters for light / paper surfaces
 * - `wordmark`       → master / archival (identical to wordmark-dark)
 */
export const WORDMARK_MASTER = require("@/assets/wordmark.png")
export const WORDMARK_DARK = require("@/assets/wordmark-dark.png")
export const WORDMARK_LIGHT = require("@/assets/wordmark-light.png")

/** Intrinsic pixel size of every wordmark PNG. */
export const WORDMARK_SIZE = { width: 632, height: 206 } as const

/**
 * Pick the wordmark that contrasts the current UI theme.
 * Dark theme → pale letters (`wordmark-dark`).
 * Light theme → ink letters (`wordmark-light`).
 */
export function wordmarkForTheme(isDark: boolean) {
  return isDark ? WORDMARK_DARK : WORDMARK_LIGHT
}

export function wordmarkWidthForHeight(height: number) {
  return Math.round(height * (WORDMARK_SIZE.width / WORDMARK_SIZE.height))
}
