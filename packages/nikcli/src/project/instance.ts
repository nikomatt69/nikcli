import { Log } from "@/util/log"
import { Context } from "../util/context"
import { Project } from "./project"
import { State } from "./state"
import { GlobalBus } from "@/bus/global"
import { Filesystem } from "@/util/filesystem"
import { realpathSync } from "fs"
import path from "path"
import { Effect, Duration, ScopedCache, Scope } from "effect"
import { AppRuntime, runtimeFor } from "@/effect/runtime"

interface InstanceContext {
  directory: string
  worktree: string
  project: Project.Info
  disposers: Set<() => void | Promise<void>>
}
const context = Context.create<InstanceContext>("instance")

function normalizeDirectory(directory: string) {
  try {
    return realpathSync(directory)
  } catch {
    return path.resolve(directory)
  }
}

function canonicalizePath(filepath: string) {
  const absolute = path.isAbsolute(filepath) ? filepath : `${process.cwd()}${path.sep}${filepath}`
  const { root } = path.parse(absolute)
  const parts = absolute
    .slice(root.length)
    .split(/[\\/]+/)
    .filter(Boolean)

  let current = root
  for (const part of parts) {
    if (part === ".") continue
    if (part === "..") {
      current = path.dirname(current)
      continue
    }

    const candidate = path.join(current, part)
    try {
      current = realpathSync(candidate)
    } catch {
      current = candidate
    }
  }

  return current
}

const instanceCacheProjectRuntime = runtimeFor(Project.defaultLayer)

// Phase G: ScopedCache-based instance cache
// Replaces the legacy Map<string, Promise<Context>>
namespace InstanceCache {
  // Module-level cache state
  let _cache: ScopedCache.ScopedCache<string, InstanceContext> | undefined
  let _scope: Scope.CloseableScope | undefined

  function ensureCache(): ScopedCache.ScopedCache<string, InstanceContext> {
    if (_cache) return _cache

    // ManagedRuntime with Project.Service (lookup uses fromDirectory)
    const result = instanceCacheProjectRuntime.runSync(
      Effect.gen(function* () {
        const parentScope = yield* Scope.make()
        // Assign to module-level variable (side effect)
        _scope = parentScope
        const cache = yield* Scope.extend(
          ScopedCache.make<string, InstanceContext>({
            capacity: Number.MAX_SAFE_INTEGER,
            timeToLive: Duration.infinity,
            lookup: (directory: string) => {
              // Transform the effect so error type is never
              // ScopedCache requires the lookup to never fail
              const effect = Effect.gen(function* () {
                const projectService = yield* Project.Service
                const result = yield* projectService.fromDirectory(directory)
                return {
                  directory,
                  worktree: result.sandbox,
                  project: result.project,
                  disposers: new Set<() => void | Promise<void>>(),
                } satisfies InstanceContext
              })
              // Cast through unknown to satisfy ScopedCache's error=never requirement
              return effect as unknown as Effect.Effect<InstanceContext, never, Scope.Scope>
            },
          }),
          parentScope,
        )
        return cache
      }),
    )

    _cache = result
    return _cache
  }

  export function get(directory: string): Effect.Effect<InstanceContext, never, Scope.Scope> {
    const cache = ensureCache()
    return cache.get(directory)
  }

  /** Cache get bound to the module parent scope; runnable on `instanceCacheProjectRuntime` only. */
  export function effectForProvide(directory: string): Effect.Effect<InstanceContext, never, never> {
    const cache = ensureCache()
    return Scope.extend(cache.get(directory), _scope!)
  }

  export function invalidate(directory: string): void {
    if (_cache) {
      // Run invalidation in background - fire and forget
      AppRuntime.runPromise(_cache.invalidate(directory)).catch(() => {})
    }
  }

  export function close(): void {
    if (_scope) {
      // Cast through unknown to access close() method that TypeScript isn't finding
      const closable = _scope as unknown as { close: () => Effect.Effect<boolean> }
      AppRuntime.runPromise(closable.close()).catch(() => {})
      _cache = undefined
      _scope = undefined
    }
  }
}

export const Instance = {
  async provide<R>(input: { directory: string; init?: () => Promise<any>; fn: () => R }): Promise<R> {
    const directory = normalizeDirectory(input.directory)

    // Phase G: Use ScopedCache for instance provisioning
    let ctx: InstanceContext
    try {
      // Run the cache get effect with the runtime that has Project.Service
      // The cache lookup needs Project.Service which is in InstanceCacheRuntime
      ctx = await instanceCacheProjectRuntime.runPromise(InstanceCache.effectForProvide(directory))
    } catch (err) {
      Log.Default.warn("instance creation failed", { directory, error: err })
      throw err
    }

    // Run init within the context
    await context.provide(ctx, async () => {
      await input.init?.()
    })

    // Execute fn with context
    return context.provide(ctx, () => input.fn())
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
      const canonicalWorktree = Instance.worktree === "/" ? "/" : realpathSync(Instance.worktree)
      const canonicalPath = canonicalizePath(filepath)
      if (Filesystem.contains(canonicalInstance, canonicalPath)) return true
      if (canonicalWorktree === "/") return false
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
      Log.Default.warn("failed to publish instance disposal event", { directory: ctx.directory, error })
    })

    const tasks = [
      State.dispose(ctx.directory),
      ...Array.from(ctx.disposers, (disposer) =>
        Promise.resolve()
          .then(() => disposer())
          .catch((error) => {
            Log.Default.warn("instance disposer failed", { directory: ctx.directory, error })
          }),
      ),
    ]

    await Promise.allSettled(tasks)
    ctx.disposers.clear()

    // Phase G: Invalidate from ScopedCache
    InstanceCache.invalidate(ctx.directory)
  },
  async disposeAll() {
    Log.Default.info("disposing all instances")

    // Phase G: Close the ScopedCache (closes all entry scopes)
    InstanceCache.close()
  },
}
