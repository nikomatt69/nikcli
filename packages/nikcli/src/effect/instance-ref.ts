import type { Project } from "@/project/project"
import { Context, Effect, Option } from "effect"

export interface InstanceContext {
  readonly directory: string
  readonly worktree: string
  readonly project: Project.Info
}

export interface WorkspaceContext {
  readonly id?: string
}

export class InstanceRef extends Context.Service<InstanceRef, InstanceContext>()("@nikcli/InstanceRef") {}
export class WorkspaceRef extends Context.Service<WorkspaceRef, WorkspaceContext>()("@nikcli/WorkspaceRef") {}

export const currentInstance = Effect.serviceOption(InstanceRef)
export const currentWorkspace = Effect.serviceOption(WorkspaceRef)

export const instance = Effect.gen(function* () {
  const serviceCtx = yield* currentInstance
  if (Option.isSome(serviceCtx)) return serviceCtx.value

  return yield* Effect.fail(new Error("No active nikcli instance in Effect context"))
})

export const workspace = Effect.map(currentWorkspace, (ctx) => Option.getOrUndefined(ctx))

export function locallyInstance<A, E, R>(
  ctx: InstanceContext,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, InstanceRef>> {
  return effect.pipe(Effect.provideService(InstanceRef, ctx)) as Effect.Effect<A, E, Exclude<R, InstanceRef>>
}

export function locallyWorkspace<A, E, R>(
  ctx: WorkspaceContext,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, WorkspaceRef>> {
  return effect.pipe(Effect.provideService(WorkspaceRef, ctx)) as Effect.Effect<A, E, Exclude<R, WorkspaceRef>>
}
