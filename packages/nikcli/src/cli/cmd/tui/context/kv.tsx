import { Global } from "@/global"
import { createSignal, type Setter } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"
import path from "path"

/** Single source of truth for the on-disk KV store location. */
export function kvFilePath(): string {
  return path.join(Global.Path.state, "kv.json")
}

/**
 * Read the persisted KV store directly from disk, before the KVProvider context
 * mounts. Used by callers that need a stored value during pre-render startup
 * (e.g. the theme mode, to skip the blocking terminal detection). Keeping the
 * path + parse here means consumers can't drift from KVProvider's storage shape.
 * Returns an empty object when the file is missing or unreadable.
 */
export async function readKVStore(): Promise<Record<string, unknown>> {
  return Bun.file(kvFilePath())
    .json()
    .catch(() => ({}) as Record<string, unknown>)
}

export const { use: useKV, provider: KVProvider } = createSimpleContext({
  name: "KV",
  init: () => {
    const [ready, setReady] = createSignal(false)
    const [store, setStore] = createStore<Record<string, any>>()
    const file = Bun.file(kvFilePath())

    file
      .json()
      .then((x) => {
        setStore(x)
      })
      .catch(() => {})
      .finally(() => {
        setReady(true)
      })

    let flushTimer: ReturnType<typeof setTimeout> | undefined

    const result = {
      get ready() {
        return ready()
      },
      get store() {
        return store
      },
      signal<T>(name: string, defaultValue: T) {
        if (store[name] === undefined) setStore(name, defaultValue)
        return [
          function () {
            return result.get(name)
          },
          function setter(next: Setter<T>) {
            result.set(name, next)
          },
        ] as const
      },
      get(key: string, defaultValue?: any) {
        return store[key] ?? defaultValue
      },
      set(key: string, value: any) {
        setStore(key, value)
        // Debounce writes to disk (flush on exit via onCleanup)
        if (flushTimer) clearTimeout(flushTimer)
        flushTimer = setTimeout(() => {
          flushTimer = undefined
          Bun.write(file, JSON.stringify(store, null, 2))
        }, 250)
      },
      flush() {
        if (flushTimer) {
          clearTimeout(flushTimer)
          flushTimer = undefined
        }
        Bun.write(file, JSON.stringify(store, null, 2))
      },
    }

    // Ensure pending writes are flushed on exit
    process.on("exit", () => result.flush())

    return result
  },
})
