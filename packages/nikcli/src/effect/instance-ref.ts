import type { Project } from "@/project/project"
import { Context, Effect, FiberRef, Option } from "effect"

export interface InstanceContext {
  readonly directory: string
  readonly worktree: string
  readonly project: Project.Info
}

export interface WorkspaceContext {
  readonly id?: string
}

export class InstanceRef extends Context.Tag("@nikcli/InstanceRef")<InstanceRef, InstanceContext>() {}
export class WorkspaceRef extends Context.Tag("@nikcli/WorkspaceRef")<WorkspaceRef, WorkspaceContext>() {}

const currentInstanceRef = FiberRef.unsafeMake<Option.Option<InstanceContext>>(Option.none())
const currentWorkspaceRef = FiberRef.unsafeMake<Option.Option<WorkspaceContext>>(Option.none())

export const currentInstance = FiberRef.get(currentInstanceRef)
export const currentWorkspace = FiberRef.get(currentWorkspaceRef)

export const instance = Effect.gen(function* () {
  const fiberCtx = yield* currentInstance
  if (Option.isSome(fiberCtx)) return fiberCtx.value

  const serviceCtx = yield* Effect.serviceOption(InstanceRef)
  if (Option.isSome(serviceCtx)) return serviceCtx.value

  return yield* Effect.fail(new Error("No active nikcli instance in Effect context"))
})

export const workspace = Effect.map(currentWorkspace, (ctx) => Option.getOrUndefined(ctx))

export function locallyInstance<A, E, R>(ctx: InstanceContext, effect: Effect.Effect<A, E, R>) {
  return effect.pipe(
    Effect.provideService(InstanceRef, ctx),
    Effect.locally(currentInstanceRef, Option.some(ctx)),
  )
}

export function locallyWorkspace<A, E, R>(ctx: WorkspaceContext, effect: Effect.Effect<A, E, R>) {
  return effect.pipe(
    Effect.provideService(WorkspaceRef, ctx),
    Effect.locally(currentWorkspaceRef, Option.some(ctx)),
  )
}
