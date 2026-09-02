import { Log } from "@nikcli-ai/util/log"
import { Context } from "../util/context"
import { Project } from "./project"
import { State } from "./state"
import { Filesystem } from "@nikcli-ai/util/filesystem"
import { realpathSync } from "fs"
import path from "path"
import { Duration, Effect, Exit, Layer, ScopedCache, Scope, type ManagedRuntime } from "effect"
import { runService } from "@/effect"
import { InstanceRef } from "@/effect/instance-ref"

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
  /**
   * Set the moment teardown begins, before the first disposer runs.
   *
   * Accessors throw once this is set: the cache entry is gone, and a caller
   * that keeps reading `Instance.directory` is holding a disposed instance.
   * `dispose` / `registerDisposer` still resolve the context off the ambient
   * scope so teardown can finish. Distinct from `disposing`, which is set
   * before the disposal event publishes so a concurrent `dispose()` is a
   * no-op without blinding `Bus.publish`'s ALS read.
   */
  disposed?: boolean
  disposing?: boolean
  /**
   * Per-directory Effect runtime whose layer provides `InstanceRef`.
   * Fibers forked onto it see the instance without reading ALS.
   */
  runtime?: ManagedRuntime.ManagedRuntime<any, any>
}
const context = Context.create<Context>("instance")

/**
 * Per-directory instance cache. Lookup creates the context (`fromDirectory`);
 * `init` is not part of lookup — it is a property of the instance, run by
 * `provide` after the entry exists, the same path whether this is the first
 * acquisition or a later one. A failed lookup expires immediately so the
 * next caller retries creation; a failed `init` does not evict, because the
 * instance was already built and other callers may hold it.
 *
 * The owning scope is process-lifetime: `dispose` / `disposeAll` invalidate
 * entries, they do not close this scope. Closing it would mark the cache
 * Closed and every later `provide` would interrupt.
 */
const instanceScope = Scope.makeUnsafe()
const cache = Effect.runSync(
  ScopedCache.makeWith<string, Context, Error>({
    capacity: Number.MAX_SAFE_INTEGER,
    lookup: (directory) => createInstance(directory),
    timeToLive: (exit) => (Exit.isFailure(exit) ? Duration.zero : Duration.infinity),
  }).pipe(Effect.provideService(Scope.Scope, instanceScope)),
)

let makeRuntime: typeof import("@/effect/runtime").makeRuntime | undefined

async function ensureRuntime(ctx: Context) {
  if (ctx.runtime) return ctx.runtime
  if (!makeRuntime) {
    ;({ makeRuntime } = await import("@/effect/runtime"))
  }
  ctx.runtime = makeRuntime(
    Layer.succeed(InstanceRef, {
      directory: ctx.directory,
      worktree: ctx.worktree,
      project: ctx.project,
    }),
  )
  return ctx.runtime
}

function useLive() {
  const ctx = context.use()
  if (ctx.disposed) throw new Error("instance has been disposed")
  return ctx
}

function createInstance(directory: string) {
  return Effect.tryPromise({
    try: async () => {
      Log.Default.info("creating instance", { directory })
      const { project, sandbox } = await runProject(
        Effect.gen(function* () {
          const project = yield* Project.Service
          return yield* project.fromDirectory(directory)
        }),
      )
      return {
        directory,
        worktree: sandbox,
        project,
        disposers: new Set<() => void | Promise<void>>(),
      } satisfies Context
    },
    catch: (error) => (error instanceof Error ? error : new Error(String(error), { cause: error })),
  })
}

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
  async provide<R>(input: { directory: string; init?: (instance: Context) => Promise<any>; fn: () => R }): Promise<R> {
    const directory = normalizeDirectory(input.directory)
    let ctx: Context
    try {
      ctx = await Effect.runPromise(ScopedCache.get(cache, directory))
    } catch (err) {
      Log.Default.warn("instance creation failed", { directory, error: err })
      throw err
    }

    await ensureRuntime(ctx)

    // Bootstrap belongs to the instance, not to whoever reached it first.
    // Without this, an acquisition that passes no `init` — the mobile session
    // route creating a fresh worktree, for one — permanently decides that the
    // directory is never bootstrapped, and every later caller's `init` is
    // dropped in silence. Single-flight, so concurrent askers share one run.
    //
    // Lookup does not run `init`. The first caller that passes one used to
    // bake it into the creation promise, which meant a concurrent waiter that
    // did not ask for bootstrap still failed when that init exploded, and the
    // instance was evicted. Creation and bootstrap are different failures:
    // a failed `fromDirectory` expires out of the cache, a failed `init`
    // clears `bootstrapped` and leaves the entry.
    if (input.init) {
      let pending = ctx.bootstrapped
      if (!pending) {
        const init = input.init
        // Inside the scope, and handed the context it is bootstrapping:
        // `InstanceBootstrap` registers disposers on it, and everything it
        // starts is threaded from the context rather than read back out of
        // the ambient scope.
        pending = context.provide(ctx, async () => {
          await init(ctx)
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
    return Effect.runSync(ScopedCache.has(cache, normalizeDirectory(directory)))
  },
  /** R2 boundary: ALS definition site. Callers that still need a getter come through here. */
  get directory() {
    return useLive().directory
  },
  get worktree() {
    return useLive().worktree
  },
  get project() {
    return useLive().project
  },
  /**
   * The per-directory `ManagedRuntime` whose layer provides `InstanceRef`.
   * Only valid inside `provide`: Effect callers go through `InstanceScope.with`,
   * which forks onto this runtime instead of the process-wide `AppRuntime`.
   */
  get runtime() {
    const runtime = context.use().runtime
    if (!runtime) throw new Error("instance runtime has not been created")
    return runtime
  },
  containsPath(filepath: string) {
    try {
      // R2 boundary: sync containment API; threading would hit tool/bash and external-directory.
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
    // R2 boundary: per-directory state key is the ambient directory by construction.
    return State.create(() => Instance.directory, init, dispose)
  },
  registerDisposer(disposer: () => void | Promise<void>) {
    const ctx = context.use()
    if (ctx.disposed) {
      // The set has already been walked and will not be walked again, and the
      // cache entry that would have reached it is deleted, so adding to it
      // drops the disposer silently. Whatever it closes was created on an
      // instance that is already gone, so close it now.
      void Promise.resolve()
        .then(() => disposer())
        .catch((error) => {
          Log.Default.warn("late instance disposer failed", { directory: ctx.directory, error })
        })
      return
    }
    ctx.disposers.add(disposer)
  },
  async dispose() {
    const ctx = context.use()
    // Teardown is idempotent. Both calls resolve the same context off the
    // ambient scope, and `disposers.clear()` only ever protected the disposer
    // set: the disposal event and the state teardown outside it ran twice.
    if (ctx.disposed || ctx.disposing) return
    ctx.disposing = true
    Log.Default.info("disposing instance", { directory: ctx.directory })

    const { Bus } = await import("@/bus")
    // Publish while accessors still answer: `Bus.publish` crosses
    // `withCurrentInstance`, which reads `Instance.directory` from ALS.
    // Blinding first turned every disposal event into a failed publish.
    await Bus.publish(Bus.InstanceDisposed, { directory: ctx.directory }).catch((error) => {
      Log.Default.warn("failed to publish instance disposal event", {
        directory: ctx.directory,
        error,
      })
    })

    // Mark disposed before the disposer walk, not after it, so a registration
    // that arrives mid-teardown runs instead of being dropped.
    ctx.disposed = true

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
    await Effect.runPromise(ScopedCache.invalidate(cache, ctx.directory))
    const runtime = ctx.runtime
    ctx.runtime = undefined
    if (runtime) {
      await runtime.dispose().catch((error) => {
        Log.Default.warn("instance runtime dispose failed", { directory: ctx.directory, error })
      })
    }
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
    const live = await Effect.runPromise(ScopedCache.entries(cache))
    for (const [, ctx] of live) {
      await context.provide(ctx, async () => {
        await Instance.dispose()
      })
    }
    await Effect.runPromise(ScopedCache.invalidateAll(cache))
    // State read back after its instance was disposed rebuilt under the same
    // directory key with no cache entry left to reach it. Collect those here
    // rather than leaving them for a later acquire-and-dispose of that
    // directory that may never come.
    await State.disposeAll()
  },
}
