import fs from "fs"
import path from "path"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Global } from "@nikcli-ai/util/global"
import { Log } from "@nikcli-ai/util/log"
import {
  InstanceState,
  runPromiseWithLayer,
  withCurrentInstance,
  withInstanceAsync,
  type InstanceContext,
} from "@/effect"
import { Effect, Schema } from "effect"
import { Instance } from "./instance"

/**
 * In-process hot reload for an instance.
 *
 * Watches the config surface of the current instance (project nikcli.json
 * files, `.nikcli` config directories, the global config file) and, when any
 * of them change on disk, invalidates the reloadable per-instance caches so
 * services rebuild their state from the new files on next access. Runtime
 * state that must survive a reload — bus subscriptions, live sessions, loop
 * engines, schedulers — is deliberately untouched.
 *
 * Every reload is announced on the bus (and therefore on the server's SSE
 * event stream), so connected clients can refetch config/agents/commands and
 * stay in sync with the backend without polling or restarting.
 */
export namespace InstanceReload {
  const log = Log.create({ service: "instance.reload" })

  const DEBOUNCE_MS = 300

  /**
   * Both internal: no subscriber in this process or in any client. What a
   * client actually needs from a reload is the invalidated state itself, which
   * arrives as `config`/provider events; these two carry the reloading
   * machinery's own progress, including the absolute paths of the files that
   * triggered it. See `specs/v2/public-event-filter.md`.
   */
  export const Event = {
    Started: BusEvent.schema(
      "instance.reload.started",
      Schema.Struct({
        directory: Schema.String,
        files: Schema.Array(Schema.String),
      }),
      { visibility: "internal" },
    ),
    Completed: BusEvent.schema(
      "instance.reloaded",
      Schema.Struct({
        directory: Schema.String,
        files: Schema.Array(Schema.String),
        durationMs: Schema.Number,
      }),
      { visibility: "internal" },
    ),
  }

  // One reload at a time per directory; concurrent triggers chain behind the
  // in-flight one instead of interleaving cache invalidations.
  const inflight = new Map<string, Promise<void>>()

  /**
   * Reload one instance's reloadable state. The directory is passed rather
   * than read from the ambient scope: the watcher fires on a timer, where
   * "which instance am I in" is whatever scope the watch was armed in.
   */
  export function reload(directory: string, files: string[] = []): Promise<void> {
    const previous = inflight.get(directory) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(() => run(directory, files))
    inflight.set(directory, next)
    const settle = () => {
      if (inflight.get(directory) === next) inflight.delete(directory)
    }
    next.then(settle, settle)
    return next
  }

  async function run(directory: string, files: string[]) {
    const started = Date.now()
    await Bus.publish(Event.Started, { directory, files })
    await Effect.runPromise(InstanceState.invalidateReloadable(directory))
    const durationMs = Date.now() - started
    await Bus.publish(Event.Completed, { directory, files, durationMs })
    log.info("instance reloaded", { directory, files, durationMs })
  }

  async function configDirectories(): Promise<string[]> {
    const { Config } = await import("@/config/config")
    return runPromiseWithLayer(
      Config.defaultLayer,
      withCurrentInstance(
        Effect.gen(function* () {
          const config = yield* Config.Service
          return yield* config.directories()
        }),
      ),
    )
  }

  /**
   * Start watching the instance's config surface. Returns a stop function;
   * the caller is responsible for registering it as an instance disposer.
   */
  export async function watch(instance: InstanceContext): Promise<() => void> {
    const directory = instance.directory
    const worktree = instance.worktree

    // Watch parent directories rather than files: editors and `Config.update`
    // replace files atomically (write + rename), which ends a file watch.
    const targets = new Map<string, (filename: string) => boolean>()
    const watchFile = (filepath: string) => {
      const dir = path.dirname(filepath)
      const name = path.basename(filepath)
      const existing = targets.get(dir)
      targets.set(dir, existing ? (filename) => existing(filename) || filename === name : (f) => f === name)
    }
    const watchDir = (dir: string) => {
      targets.set(dir, () => true)
    }

    watchFile(path.join(Global.Path.config, "nikcli.json"))
    watchFile(path.join(directory, "nikcli.json"))
    if (worktree !== "/" && worktree !== directory) watchFile(path.join(worktree, "nikcli.json"))
    for (const dir of await configDirectories().catch((error): string[] => {
      log.warn("failed to resolve config directories for hot reload", { directory, error })
      return []
    })) {
      watchDir(dir)
    }

    const watchers: fs.FSWatcher[] = []
    let pending: Set<string> | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false

    const flush = () => {
      timer = undefined
      const files = [...(pending ?? [])]
      pending = undefined
      if (stopped || !Instance.has(directory)) return
      void withInstanceAsync({ directory }, async () => reload(directory, files)).catch((error) => {
        log.warn("hot reload failed", { directory, error })
      })
    }

    const schedule = (file: string) => {
      ;(pending ??= new Set()).add(file)
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, DEBOUNCE_MS)
      timer.unref?.()
    }

    for (const [dir, accepts] of targets) {
      if (!fs.existsSync(dir)) continue
      try {
        const watcher = fs.watch(dir, (_eventType, filename) => {
          if (!filename) return
          if (!accepts(filename)) return
          schedule(path.join(dir, filename))
        })
        watcher.on("error", (error) => {
          log.warn("config watcher error", { dir, error })
        })
        watchers.push(watcher)
      } catch (error) {
        log.warn("failed to watch config path", { dir, error })
      }
    }

    log.info("watching config for hot reload", { directory, paths: watchers.length })

    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      for (const watcher of watchers) {
        try {
          watcher.close()
        } catch {}
      }
    }
  }
}
