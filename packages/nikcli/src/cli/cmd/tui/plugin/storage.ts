import type { TuiMemoryEntry, TuiStoreEntry, TuiStorage } from "@nikcli-ai/plugin/tui"
import { mkdirSync, readFileSync, watch, type FSWatcher } from "fs"
import { rename } from "fs/promises"
import path from "path"
import { createStore, produce, reconcile } from "solid-js/store"
import { Global } from "@/global"
import { Flock } from "@/util/flock"
import { Log } from "@/util/log"

const log = Log.create({ service: "tui.plugin.storage" })

/**
 * Ephemeral per-process plugin state.
 *
 * Entries are memoized here, above the plugin lifecycle, so a hot reload hands
 * the same live Solid store to the new generation: a plugin's in-memory state
 * (counters, drafts, caches) survives its own edit with no serialize/rehydrate
 * step. Everything is gone when the TUI exits.
 */
const memories = new Map<string, TuiMemoryEntry<object>>()

/**
 * Durable per-plugin state: one JSON file per key under the state directory.
 *
 * Like `memory`, entries are memoized above the plugin lifecycle, so a hot
 * reload keeps the same live store. Unlike `memory`, they survive a restart and
 * stay in sync across TUI instances: writes take a cross-process lock and the
 * directory is watched, so another instance's write is reconciled in.
 */
type StoredEntry = {
  readonly value: TuiStoreEntry<object>
  readonly reload: () => void
}

const stored = new Map<string, StoredEntry>()
let watcher: FSWatcher | undefined

function directory() {
  return path.join(Global.Path.state, "tui", "plugin")
}

/** One filesystem-safe file name per plugin id + key pair. */
function fileName(id: string, key: string) {
  return `${`${id}.${key}`.replace(/[^A-Za-z0-9._-]/g, "-")}.json`
}

function read(file: string) {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as unknown
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return
    return raw as Record<string, unknown>
  } catch {
    // Missing, half-written, or corrupted: fall back to what we have.
    return
  }
}

function ensureWatcher(dir: string) {
  if (watcher) return
  try {
    watcher = watch(dir, () => {
      for (const entry of stored.values()) entry.reload()
    })
    watcher.on("error", () => {
      watcher?.close()
      watcher = undefined
    })
    watcher.unref?.()
  } catch {
    // Without a watcher the store still works, it just misses writes made by
    // another TUI instance.
  }
}

export function pluginStorage(id: string): TuiStorage {
  return {
    memory(key, options) {
      const full = `${id}.${key}`
      const existing = memories.get(full)
      if (existing) return existing as TuiMemoryEntry<typeof options.initial>

      const [store, setStore] = createStore(options.initial)
      const entry = [store, (mutation: (draft: typeof options.initial) => void) => setStore(produce(mutation))] as const
      memories.set(full, entry as TuiMemoryEntry<object>)
      return entry
    },
    store(key, options) {
      const dir = directory()
      const file = path.join(dir, fileName(id, key))
      const existing = stored.get(file)
      if (existing) return existing.value as TuiStoreEntry<typeof options.initial>

      mkdirSync(dir, { recursive: true })
      ensureWatcher(dir)

      const [store, setStore] = createStore<typeof options.initial>({
        ...options.initial,
        ...(read(file) as Partial<typeof options.initial> | undefined),
      })

      const flush = async () => {
        // Locked so two instances writing the same key cannot interleave, and
        // written through a temp file so a reader never sees partial JSON.
        const lease = await Flock.acquire(`tui-plugin-storage:${file}`).catch(() => undefined)
        try {
          const temp = `${file}.${process.pid}.tmp`
          await Bun.write(temp, JSON.stringify(store, null, 2))
          await rename(temp, file)
        } catch (error) {
          log.warn("failed to persist plugin storage", { file, error })
        } finally {
          await lease?.release().catch(() => undefined)
        }
      }

      const entry = [
        store,
        async (mutation: (draft: typeof options.initial) => void) => {
          setStore(produce(mutation))
          await flush()
        },
      ] as const

      stored.set(file, {
        value: entry as TuiStoreEntry<object>,
        reload: () => {
          const next = read(file)
          if (!next) return
          setStore(reconcile({ ...options.initial, ...(next as Partial<typeof options.initial>) }))
        },
      })
      return entry
    },
  }
}

/** Drops every memoized store. Only for shutdown and tests. */
export function clearPluginStorage() {
  memories.clear()
  stored.clear()
  watcher?.close()
  watcher = undefined
}
