/**
 * Build identity: what this binary is and which channel it came from.
 *
 * Both are `define`s injected by the build (`script/build.ts`), with a "local" fallback so a dev
 * checkout — where nothing is defined — reports something honest instead of crashing.
 *
 * These live here rather than in `installation/` because reading the version is not an
 * installation concern: seven TUI files import `Installation.VERSION` only to print it, and that
 * pulled the whole upgrade subsystem — bus events, Effect layers, the release checker — into the
 * graph of anything that wanted a string in a footer.
 */
declare global {
  const NIKCLI_VERSION: string
  const NIKCLI_CHANNEL: string
}

export const VERSION = typeof NIKCLI_VERSION === "string" ? NIKCLI_VERSION : "local"
export const CHANNEL = typeof NIKCLI_CHANNEL === "string" ? NIKCLI_CHANNEL : "local"

/** How nikcli was installed. Clients need the union to label an update, not the upgrade logic. */
export type InstallMethod = "curl" | "npm" | "yarn" | "pnpm" | "bun" | "brew" | "scoop" | "choco" | "unknown"

/**
 * Bus event names the terminal subscribes to.
 *
 * Same split as `tui-event-schema`: the name is a string on the wire, and reaching for it should
 * not pull in the upgrade subsystem that publishes it.
 */
export const InstallationEventName = {
  updated: "installation.updated",
  updateAvailable: "installation.update-available",
} as const
