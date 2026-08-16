/**
 * Shared state for the math-rendering plugin.
 *
 * The flag lives in the TUI key-value store (`Global.Path.state/kv.json`)
 * rather than in `nikcli.json`: math rendering is a per-machine preference
 * that `/math` flips live mid-session, and the session route reads it through
 * the same minimal interface — so the command and the rendered view change
 * exactly the same thing.
 */
export type KVLike = {
  get: <Value = unknown>(key: string, fallback?: Value) => Value
  set: (key: string, value: unknown) => void
}

export const MATH_KV_KEY = "math_rendering"

/**
 * Off by default. While a message streams, the math path re-splits the whole
 * text on every chunk and swaps markdown blocks for formula renderables as
 * delimiters open and close — visible as flicker on fast streams. Keeping the
 * feature opt-in means the default message path is a single `<markdown>`,
 * exactly what the call sites rendered before the feature existed.
 */
export function readEnabled(kv: KVLike): boolean {
  return kv.get<boolean>(MATH_KV_KEY, false) === true
}

export function writeEnabled(kv: KVLike, enabled: boolean) {
  kv.set(MATH_KV_KEY, enabled)
  return enabled
}
