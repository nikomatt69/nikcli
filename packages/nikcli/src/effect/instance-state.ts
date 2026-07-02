import { Instance } from "@/project/instance"
import { Duration, Effect, ScopedCache, Scope } from "effect"
import { instance, type InstanceContext } from "./instance-ref"

export const context: Effect.Effect<InstanceContext> = instance.pipe(
  Effect.catch(() =>
    Effect.sync(() => ({
      directory: Instance.directory,
      worktree: Instance.worktree,
      project: Instance.project,
    })),
  ),
)

export const directory = Effect.map(context, (ctx) => ctx.directory)
export const worktree = Effect.map(context, (ctx) => ctx.worktree)
export const project = Effect.map(context, (ctx) => ctx.project)

// Per-instance caches that opted into hot reload: invalidating them for a
// directory forces the next access to rebuild state from disk (fresh config,
// agents, commands, ...) without restarting the process or tearing down
// runtime state (bus subscriptions, loop engines, live sessions).
const reloadable = new Set<ScopedCache.ScopedCache<string, any>>()

export function make<S>(
  init: (ctx: InstanceContext) => Effect.Effect<S, never, Scope.Scope>,
  options?: { reloadable?: boolean },
): Effect.Effect<ScopedCache.ScopedCache<string, S>, never, Scope.Scope> {
  return ScopedCache.make({
    capacity: Number.MAX_SAFE_INTEGER,
    timeToLive: Duration.infinity,
    lookup: (key: string) =>
      context.pipe(
        Effect.flatMap((ctx) => init(ctx)),
        Effect.annotateLogs({ instance: key }),
      ),
  }).pipe(
    Effect.tap((cache) =>
      Effect.sync(() => {
        if (options?.reloadable) reloadable.add(cache)
      }),
    ),
  )
}

/**
 * Invalidate every reloadable per-instance cache entry for a directory.
 * Entry finalizers run; state is rebuilt lazily on next access. Caches whose
 * owning scope has already closed (disposed runtime) are dropped from the
 * registry instead of failing the reload.
 */
export function invalidateReloadable(directory: string): Effect.Effect<void> {
  return Effect.forEach(
    [...reloadable],
    (cache) =>
      Effect.exit(ScopedCache.invalidate(cache, directory)).pipe(
        Effect.map((exit) => {
          if (exit._tag === "Failure") reloadable.delete(cache)
        }),
      ),
    { discard: true },
  )
}

export function get<S>(cache: ScopedCache.ScopedCache<string, S>): Effect.Effect<S> {
  return Effect.scoped(context.pipe(Effect.flatMap((ctx) => ScopedCache.get(cache, ctx.directory))))
}
