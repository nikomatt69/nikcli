import { Instance } from "@/project/instance"
import { Cause, Effect, Exit } from "effect"
import { locallyInstance, locallyWorkspace, type InstanceContext } from "./instance-ref"

export interface WithInput {
  readonly directory: string
  readonly workspaceID?: string
}

export const InstanceScope = {
  with<A, E, R>(input: WithInput, effect: Effect.Effect<A, E, R>): Effect.Effect<A, unknown> {
    return Effect.tryPromise({
      try: async () => {
        return await Instance.provide({
          directory: input.directory,
          fn: async () => {
            const ctx: InstanceContext = {
              directory: Instance.directory,
              worktree: Instance.worktree,
              project: Instance.project,
            }
            const scoped = input.workspaceID
              ? locallyWorkspace({ id: input.workspaceID }, locallyInstance(ctx, effect))
              : locallyInstance(ctx, effect)
            const exit = await Effect.runPromiseExit(scoped as Effect.Effect<A, E, never>)
            if (Exit.isSuccess(exit)) return exit.value
            throw Cause.squash(exit.cause)
          },
        })
      },
      catch: (error) => {
        return error instanceof Error ? error : new Error(String(error), { cause: error })
      },
    })
  },
}
