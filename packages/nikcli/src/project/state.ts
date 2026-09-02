import { Log } from "@nikcli-ai/util/log"

export namespace State {
  interface Entry {
    state: any
    dispose?: (state: any) => Promise<void>
  }

  const log = Log.create({ service: "state" })
  const recordsByKey = new Map<string, Map<any, Entry>>()

  export function create<S>(root: () => string, init: () => S, dispose?: (state: Awaited<S>) => Promise<void>) {
    return () => {
      const key = root()
      let entries = recordsByKey.get(key)
      if (!entries) {
        entries = new Map<string, Entry>()
        recordsByKey.set(key, entries)
      }
      const exists = entries.get(init)
      if (exists) {
        // SAFETY: entries are keyed by the `init` function itself, so an entry
        // found under this key was produced by this very initialiser and its
        // state is that initialiser's `S`.
        return exists.state as S
      }
      const state = init()
      entries.set(init, {
        state,
        dispose,
      })
      return state
    }
  }

  /**
   * Dispose every remaining key. Used at shutdown to collect state whose
   * instance is already gone: reading a state cell after `Instance.dispose`
   * rebuilds it under the same directory key, and the cache entry that would
   * otherwise have reached it has been deleted.
   */
  export async function disposeAll() {
    // Snapshot the keys: `dispose` deletes the entry it just drained, so
    // walking the live iterator would mutate the map mid-iteration.
    const keys = Array.from(recordsByKey.keys())
    for (const key of keys) await dispose(key)
  }

  export async function dispose(key: string) {
    const entries = recordsByKey.get(key)
    if (!entries) return

    log.info("waiting for state disposal to complete", { key })

    let disposalFinished = false

    setTimeout(() => {
      if (!disposalFinished) {
        log.warn(
          "state disposal is taking an unusually long time - if it does not complete in a reasonable time, please report this as a bug",
          { key },
        )
      }
    }, 10000).unref()

    const tasks: Promise<void>[] = []
    for (const entry of entries.values()) {
      if (!entry.dispose) continue

      const task = Promise.resolve(entry.state)
        .then((state) => entry.dispose!(state))
        .catch((error) => {
          log.error("Error while disposing state:", { error, key })
        })

      tasks.push(task)
    }
    // Execute disposal tasks BEFORE clearing state
    await Promise.all(tasks)
    entries.clear()
    recordsByKey.delete(key)
    disposalFinished = true
    log.info("state disposal completed", { key })
  }
}
