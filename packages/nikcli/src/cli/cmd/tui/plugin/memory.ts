import type { TuiMemoryEntry, TuiStorage } from "@nikcli-ai/plugin/tui"
import { createStore, produce } from "solid-js/store"

/**
 * Ephemeral per-process plugin state.
 *
 * Entries are memoized here, above the plugin lifecycle, so a hot reload hands
 * the same live Solid store to the new generation: a plugin's in-memory state
 * (counters, drafts, caches) survives its own edit with no serialize/rehydrate
 * step. Everything is gone when the TUI exits; `api.kv` is the durable store.
 */
const stores = new Map<string, TuiMemoryEntry<object>>()

export function pluginMemory(id: string): TuiStorage {
  return {
    memory(key, options) {
      const full = `plugin.${id}.${key}`
      const existing = stores.get(full)
      if (existing) return existing as TuiMemoryEntry<typeof options.initial>

      const [store, setStore] = createStore(options.initial)
      const entry = [store, (mutation: (draft: typeof options.initial) => void) => setStore(produce(mutation))] as const
      stores.set(full, entry as TuiMemoryEntry<object>)
      return entry
    },
  }
}

/** Drops every memoized store. Only for shutdown and tests. */
export function clearPluginMemory() {
  stores.clear()
}
