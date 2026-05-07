import { Instance } from "@/project/instance"
import { Duration, Effect, ScopedCache, Scope } from "effect"
import { instance, type InstanceContext } from "./instance-ref"

export const context: Effect.Effect<InstanceContext> = instance.pipe(
  Effect.catchAll(() =>
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

export function make<S>(
  init: (ctx: InstanceContext) => Effect.Effect<S, never, Scope.Scope>,
): Effect.Effect<ScopedCache.ScopedCache<string, S>, never, Scope.Scope> {
  return ScopedCache.make({
    capacity: Number.MAX_SAFE_INTEGER,
    timeToLive: Duration.infinity,
    lookup: (key) =>
      context.pipe(
        Effect.flatMap((ctx) => init(ctx)),
        Effect.annotateLogs({ instance: key }),
      ),
  })
}

export function get<S>(cache: ScopedCache.ScopedCache<string, S>): Effect.Effect<S> {
  return Effect.scoped(context.pipe(Effect.flatMap((ctx) => cache.get(ctx.directory))))
}
