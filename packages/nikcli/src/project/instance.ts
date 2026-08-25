import { Log } from "@nikcli-ai/util/log"
import { Context } from "../util/context"
import { Project } from "./project"
import { State } from "./state"
import { Filesystem } from "@nikcli-ai/util/filesystem"
import { realpathSync } from "fs"
import path from "path"
import { Effect } from "effect"
import { runService } from "@/effect"

function runProject<A, E>(effect: Effect.Effect<A, E, Project.Service>) {
  return runService(Project, effect)
}

interface Context {
  directory: string
  worktree: string
  project: Project.Info
  disposers: Set<() => void | Promise<void>>
  /**
   * The in-flight or settled bootstrap for this instance, if one has been
   * asked for. Present means "someone has already run `init` here", so a
   * later caller passing the same `init` joins instead of repeating it.
   * Absent means no caller has asked yet — which is a reachable state,
   * because plenty of call sites acquire an instance without an `init`.
   */
  bootstrapped?: Promise<void>
}
const context = Context.create<Context>("instance")
const cache = new Map<string, Promise<Context>>()

/**
 * Whether a directory is the root of its filesystem — `/` on POSIX, `C:\` and
 * friends on Windows. Written against `path.parse` rather than a literal so the
 * two platforms are covered by the same rule.
 */
export function isFilesystemRoot(directory: string) {
  if (!directory) return false
  return directory === "/" || path.parse(directory).root === directory
}

function normalizeDirectory(directory: string) {
  try {
    return realpathSync(directory)
  } catch {
    return path.resolve(directory)
  }
}

export const Instance = {
  async provide<R>(input: { directory: string; init?: () => Promise<any>; fn: () => R }): Promise<R> {
    const directory = normalizeDirectory(input.directory)
    let existing = cache.get(directory)
    if (!existing) {
      Log.Default.info("creating instance", { directory })
      const promise = (async () => {
        const { project, sandbox } = await runProject(
          Effect.gen(function* () {
            const project = yield* Project.Service
            return yield* project.fromDirectory(directory)
          }),
        )
        const ctx: Context = {
          directory,
          worktree: sandbox,
          project,
          disposers: new Set<() => void | Promise<void>>(),
        }
        if (input.init) {
          await context.provide(ctx, async () => {
            await input.init!()
          })
          // Record it on the context, not just on the closure: the next caller
          // to pass an `init` for this directory has to be able to tell that
          // one has already run.
          ctx.bootstrapped = Promise.resolve()
        }
        return ctx
      })()
      cache.set(directory, promise)
      existing = promise
    }

    let ctx: Context
    try {
      ctx = await existing
    } catch (err) {
      if (cache.get(directory) === existing) {
        cache.delete(directory)
      }
      Log.Default.warn("instance creation failed", { directory, error: err })
      throw err
    }

    // Bootstrap belongs to the instance, not to whoever reached it first.
    // Without this, an acquisition that passes no `init` — the mobile session
    // route creating a fresh worktree, for one — permanently decides that the
    // directory is never bootstrapped, and every later caller's `init` is
    // dropped in silence. Single-flight, so concurrent askers share one run.
    if (input.init) {
      let pending = ctx.bootstrapped
      if (!pending) {
        const init = input.init
        // Inside the scope: `InstanceBootstrap` reads `Instance.directory` and
        // registers disposers on the context it is bootstrapping.
        pending = context.provide(ctx, async () => {
          await init()
        })
        ctx.bootstrapped = pending
      }
      try {
        await pending
      } catch (err) {
        // Clear so the next caller retries, the same way a failed creation is
        // evicted. The instance itself is not dropped: unlike a failed
        // creation it was already built and already handed out, and evicting
        // it here would tear down state that other callers hold.
        if (ctx.bootstrapped === pending) ctx.bootstrapped = undefined
        throw err
      }
    }

    return context.provide(ctx, async () => {
      return input.fn()
    })
  },
  has(directory: string) {
    return cache.has(normalizeDirectory(directory))
  },
  get directory() {
    return context.use().directory
  },
  get worktree() {
    return context.use().worktree
  },
  get project() {
    return context.use().project
  },
  containsPath(filepath: string) {
    try {
      const canonicalInstance = realpathSync(Instance.directory)
      const canonicalPath = Filesystem.canonicalizePath(filepath)
      if (Filesystem.contains(canonicalInstance, canonicalPath)) return true
      // A worktree sitting at the filesystem root is the "no repository" fallback
      // (`path.parse(dir).root`), not a containment boundary — treating it as one
      // puts every path on the volume inside the instance, and callers such as the
      // bash tool's external-directory check then never prompt.
      //
      // Only the POSIX spelling `/` used to be recognised, so on Windows the drive
      // root `C:\` fell straight through to the containment test, where
      // `contains("C:\\", anything-on-C)` is true.
      if (isFilesystemRoot(Instance.worktree)) return false
      const canonicalWorktree = realpathSync(Instance.worktree)
      if (isFilesystemRoot(canonicalWorktree)) return false
      return Filesystem.contains(canonicalWorktree, canonicalPath)
    } catch {
      return false
    }
  },
  state<S>(init: () => S, dispose?: (state: Awaited<S>) => Promise<void>): () => S {
    return State.create(() => Instance.directory, init, dispose)
  },
  registerDisposer(disposer: () => void | Promise<void>) {
    context.use().disposers.add(disposer)
  },
  async dispose() {
    const ctx = context.use()
    Log.Default.info("disposing instance", { directory: ctx.directory })

    const { Bus } = await import("@/bus")
    await Bus.publish(Bus.InstanceDisposed, { directory: ctx.directory }).catch((error) => {
      Log.Default.warn("failed to publish instance disposal event", {
        directory: ctx.directory,
        error,
      })
    })

    const tasks = [
      State.dispose(ctx.directory),
      ...Array.from(ctx.disposers, (disposer) =>
        Promise.resolve()
          .then(() => disposer())
          .catch((error) => {
            Log.Default.warn("instance disposer failed", {
              directory: ctx.directory,
              error,
            })
          }),
      ),
    ]

    await Promise.allSettled(tasks)
    ctx.disposers.clear()
    cache.delete(ctx.directory)
  },
  /**
   * Drop config-derived per-instance state without tearing the instance
   * down. Reloadable caches run their finalizers and rebuild lazily on the
   * next access; runtime state — bus subscriptions, live sessions, loop
   * engines, schedulers, registered disposers — survives, and the cache
   * entry stays. This is the semantics `POST /config/update` and the
   * provider auth mutations want: the request that changed the input keeps
   * a working instance, unlike `dispose`, which evicts the entry while the
   * request's ambient scope keeps answering, leaving state built after it
   * owned by nothing.
   *
   * Takes an optional directory so callers holding a key (tests, global
   * tooling) can invalidate without standing in an instance scope; without
   * one it reads the ambient scope, like `dispose`.
   */
  async invalidate(directory?: string) {
    const target = directory ?? context.use().directory
    // Lazy import: `@/effect` reaches back into this module, and a static
    // edge would close an initialization cycle.
    const { InstanceState, runPromise } = await import("@/effect")
    await runPromise(InstanceState.invalidateReloadable(target))
  },

  async disposeAll() {
    Log.Default.info("disposing all instances")
    for (const [_key, value] of cache) {
      const awaited = await value.catch(() => {})
      if (awaited) {
        await context.provide(await value, async () => {
          await Instance.dispose()
        })
      }
    }
    cache.clear()
  },
}
