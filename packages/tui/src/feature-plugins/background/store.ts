/**
 * Shared state for the background plugin.
 *
 * The settings live in the TUI key-value store, which both the plugin api
 * (`api.kv`, used by the slash commands) and the rendered view (`useKV`)
 * reach through the same minimal interface — so a command and a dialog row
 * change exactly the same thing.
 */
import { createSignal } from "solid-js"
import { BACKGROUND_KV_KEY, normalize, type BackgroundSettings } from "./settings"

export type KVLike = {
  get: <Value = unknown>(key: string, fallback?: Value) => Value
  set: (key: string, value: unknown) => void
}

export function readSettings(kv: KVLike): BackgroundSettings {
  return normalize(kv.get(BACKGROUND_KV_KEY))
}

export function writeSettings(kv: KVLike, patch: Partial<BackgroundSettings>) {
  const next: BackgroundSettings = { ...readSettings(kv), ...patch }
  kv.set(BACKGROUND_KV_KEY, next)
  return next
}

// Which image to use when the source is a folder. A module-level signal
// rather than component state: `/background shuffle` runs outside the view.
const [shuffle, setShuffle] = createSignal(0)

export const rotation = {
  get current() {
    return shuffle()
  },
  next() {
    setShuffle((value) => value + 1)
  },
}
