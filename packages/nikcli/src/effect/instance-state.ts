import { Instance } from "@/project/instance"
import { Duration, Effect, Option, ScopedCache, Scope } from "effect"
import { currentInstance, type InstanceContext } from "./instance-ref"

/**
 * The ambient instance as a plain value, read synchronously in the caller's
 * frame. Throws when there is no instance scope, exactly like the getters it
 * reads.
 *
 * `context` below is the Effect form and is what Effect code should use. This
 * exists for the promise side: several call sites were starting a fiber on a
 * `ManagedRuntime` whose only job was to read these three getters out of the
 * ambient scope, bind them to `InstanceRef`, and immediately read them back —
 * a round trip through the Effect runtime for a synchronous property access.
 *
 * R2 boundary: promise-side ambient API. Effect code uses `context` / `InstanceRef`.
 */
export function ambient(): InstanceContext {
  return {
    directory: Instance.directory,
    worktree: Instance.worktree,
    project: Instance.project,
  }
}

// `instance` fails with a freshly allocated `Error` when there is no `InstanceRef`
// in the fiber, and the only thing anyone ever did with that failure was fall back
// to `ambient()`. Reading the option directly skips the error allocation (and its
// stack capture) plus the `catch` frame on a path taken once per `Bus.publish`.
export const context: Effect.Effect<InstanceContext> = Effect.map(currentInstance, (ctx) =>
  Option.isSome(ctx) ? ctx.value : ambient(),
)

export const directory = Effect.map(context, (ctx) => ctx.directory)
export const worktree = Effect.map(context, (ctx) => ctx.worktree)
export const project = Effect.map(context, (ctx) => ctx.project)

// Per-instance caches that opted into hot reload: invalidating them for a
// directory forces the next access to rebuild state from disk (fresh config,
// agents, commands, ...) without restarting the process or tearing down
// runtime state (bus subscriptions, loop engines, live sessions).
//
// Only opt in state that is a *pure derivation* of config and files on disk.
// Invalidation runs the entry's finalizers and rebuilds lazily, so a cache that
// owns a live resource or accumulates runtime-only data loses it. Runtime tool
// registrations live in a separate non-reloadable cache in `tool/registry.ts`;
// the config-dir/plugin list next to them is reloadable.
const reloadable = new Set<ScopedCache.ScopedCache<string, any>>()

/**
 * Already-resolved entries, per cache, for `get`'s synchronous fast path.
 *
 * `ScopedCache` has no sync peek (`getOption` is itself an Effect), so every
 * `get` was paying `Effect.scoped` + a full cache lookup to re-read a value that,
 * with `capacity: MAX_SAFE_INTEGER` and `timeToLive: infinity`, is created once
 * per directory and then never changes. On `Bus.publish` — called once per
 * streaming token — that lookup measured ~1.9µs of a ~4.5µs publish.
 *
 * This is a mirror, not a second source of truth: entries are written by the
 * cache's own `lookup` and removed by a finalizer on the entry's scope, so they
 * live exactly as long as the cache entry does. Invalidation
 * (`invalidateReloadable`) and cache-scope close both run those finalizers, so
 * there is no path that drops a cache entry while leaving the mirror behind.
 */
const resolved = new WeakMap<ScopedCache.ScopedCache<string, any>, Map<string, any>>()

export function make<S>(
  init: (ctx: InstanceContext) => Effect.Effect<S, never, Scope.Scope>,
  options?: { reloadable?: boolean },
): Effect.Effect<ScopedCache.ScopedCache<string, S>, never, Scope.Scope> {
  const mirror = new Map<string, S>()
  return ScopedCache.make({
    capacity: Number.MAX_SAFE_INTEGER,
    timeToLive: Duration.infinity,
    lookup: (key: string) =>
      context.pipe(
        Effect.flatMap((ctx) => init(ctx)),
        Effect.tap((value) =>
          // Registered on the entry's own scope, so the mirror entry is dropped
          // by the same event that drops the cache entry.
          Effect.addFinalizer(() =>
            Effect.sync(() => {
              if (mirror.get(key) === value) mirror.delete(key)
            }),
          ).pipe(Effect.andThen(Effect.sync(() => mirror.set(key, value)))),
        ),
        Effect.annotateLogs({ instance: key }),
      ),
  }).pipe(
    Effect.tap((cache) =>
      Effect.sync(() => {
        resolved.set(cache, mirror)
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
  const mirror = resolved.get(cache) as Map<string, S> | undefined
  const lookup = (directory: string) => Effect.scoped(ScopedCache.get(cache, directory))
  if (!mirror) return context.pipe(Effect.flatMap((ctx) => lookup(ctx.directory)))
  return context.pipe(
    Effect.flatMap((ctx) =>
      // `has`, not a truthiness check: `undefined` is a legitimate state value.
      mirror.has(ctx.directory) ? Effect.succeed(mirror.get(ctx.directory) as S) : lookup(ctx.directory),
    ),
  )
}
