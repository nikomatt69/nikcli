/**
 * Shared state for the devtools bar.
 *
 * Lives in the TUI key-value store rather than `nikcli.json`, for the same
 * reason the math flag does: it is a per-machine preference that `/devtools`
 * flips live, mid-session, and a config round-trip would make the toggle feel
 * like a restart.
 */
export type KVLike = {
  get: <Value = unknown>(key: string, fallback?: Value) => Value
  set: (key: string, value: unknown) => void
}

export const DEVTOOLS_KV_KEY = "devtools_bar"

/**
 * Off by default.
 *
 * The bar samples on a 2s timer and holds thirty seconds of history — small,
 * but not nothing, and most sessions never need it. It is a tool you reach for
 * when something feels wrong, not a permanent tax.
 */
export function readEnabled(kv: KVLike): boolean {
  return kv.get<boolean>(DEVTOOLS_KV_KEY, false) === true
}

export function writeEnabled(kv: KVLike, enabled: boolean) {
  kv.set(DEVTOOLS_KV_KEY, enabled)
  return enabled
}
