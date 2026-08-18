import { Instance } from "@/project/instance"
import { Effect, Fiber, type Exit } from "effect"
import { locallyInstance, locallyWorkspace, type InstanceContext } from "./instance-ref"
import { AppRuntime } from "./runtime"

export interface WithInput {
  readonly directory: string
  readonly workspaceID?: string
}

export const InstanceScope = {
  /**
   * Bridge an Effect into the instance scope of `input.directory`.
   *
   * The effect must execute inside `Instance.provide`'s AsyncLocalStorage
   * scope (legacy code in effect bodies still reads `Instance.directory`
   * from ALS), so it is forked onto the shared AppRuntime from within that
   * scope. Unlike a plain promise hand-off, the bridge stays structured:
   *
   * - the inner fiber's full Exit (typed failures, defects, interruption)
   *   is rethrown in the caller's fiber instead of being squashed to Error
   * - interrupting the caller interrupts the inner fiber and waits for its
   *   finalizers before the interruption completes
   *
   * Only instance bootstrap failures surface as the widened `Error`.
   */
  with<A, E, R>(input: WithInput, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | Error> {
    return Effect.callback<A, E | Error>((resume) => {
      let inner: Fiber.Fiber<A, E> | undefined
      let cancelled = false

      Instance.provide({
        directory: input.directory,
        fn: () => {
          const ctx: InstanceContext = {
            directory: Instance.directory,
            worktree: Instance.worktree,
            project: Instance.project,
          }
          const scoped = input.workspaceID
            ? locallyWorkspace({ id: input.workspaceID }, locallyInstance(ctx, effect))
            : locallyInstance(ctx, effect)
          // SAFETY: `locallyInstance` (and `locallyWorkspace` when a workspace is
          // pinned) provide every requirement the effect declares, so nothing is
          // left for the runtime to supply.
          const fiber = AppRuntime.runFork(scoped as Effect.Effect<A, E, never>)
          inner = fiber
          if (cancelled) fiber.interruptUnsafe()
          return new Promise<Exit.Exit<A, E>>((resolve) => {
            fiber.addObserver(resolve)
          })
        },
      })
        // Instance.provide types its result as Promise<R> with R = Promise<Exit>;
        // the runtime flattens, this .then aligns the types with that.
        .then((exit) => exit)
        .then(
          // An Exit is an Effect of its own outcome: resuming with it replays
          // the inner fiber's result — including defects — in the caller's fiber.
          (exit) => resume(exit),
          (error) => resume(Effect.fail(error instanceof Error ? error : new Error(String(error), { cause: error }))),
        )

      return Effect.suspend(() => {
        cancelled = true
        const fiber = inner
        if (!fiber) return Effect.void
        return Effect.asVoid(Fiber.interrupt(fiber))
      })
    })
  },
}
