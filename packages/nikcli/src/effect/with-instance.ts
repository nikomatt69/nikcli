/**
 * Unified entry boundary for shifting plain async / CLI / TUI / route callers
 * into Effect-provided instance scope.
 *
 * Replaces the legacy `Instance.provide({ directory, fn })` pattern. Callers
 * that are already inside `Effect.gen(...)` should use `InstanceScope.with(...)`
 * directly. This helper exists for plain async entrypoints (CLI commands, TUI
 * worker bootstrap, server middleware, scripts) where wrapping the whole
 * function body in an Effect would force unrelated churn.
 */

import { Instance } from "@/project/instance"
import { Cause, Effect, Exit } from "effect"
import { locallyInstance, locallyWorkspace, type InstanceContext } from "./instance-ref"
import { AppRuntime } from "./runtime"
import { InstanceScope, type WithInput } from "./instance-scope"

/**
 * Run an Effect inside the given instance scope from a plain async caller.
 *
 * Resolves directory + project once, provides `InstanceRef` (and `WorkspaceRef`
 * if `workspaceID` is set), then awaits the Effect through `AppRuntime`.
 *
 * Use this at the outermost entry boundary, not inside per-operation helpers.
 */
export function withInstance<A, E, R>(input: WithInput, effect: Effect.Effect<A, E, R>): Promise<A> {
  return AppRuntime.runPromise(InstanceScope.with(input, effect))
}

/**
 * Run a plain async body inside an instance scope. Direct replacement for
 * `Instance.provide({ directory, fn: async () => { ... } })` at the outer
 * entry boundary. The body becomes an Effect.promise inside InstanceScope.with.
 *
 * Prefer the `withInstance(input, Effect.gen(...))` shape for new code; this
 * helper exists to keep large legacy CLI bodies compiling while their
 * surrounding callers progressively migrate.
 *
 * If `init` is provided, it runs once per directory before `fn` (matches the
 * legacy `Instance.provide({ init, fn })` semantics — InstanceBootstrap and
 * similar one-time per-directory hooks). Removed in Phase G when the keyed
 * scoped runtime replaces the promise cache.
 */
export function withInstanceAsync<R>(
  input: WithInput & { init?: () => Promise<unknown> },
  fn: () => Promise<R>,
): Promise<R> {
  if (input.init) {
    return Instance.provide({
      directory: input.directory,
      init: input.init,
      fn: (): Promise<R> => {
        const ctx: InstanceContext = {
          directory: Instance.directory,
          worktree: Instance.worktree,
          project: Instance.project,
        }
        const effect = Effect.tryPromise({
          try: fn,
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        })
        const scoped = input.workspaceID
          ? locallyWorkspace({ id: input.workspaceID }, locallyInstance(ctx, effect))
          : locallyInstance(ctx, effect)
        return AppRuntime.runPromiseExit(scoped as Effect.Effect<R, Error, never>).then((exit) => {
          if (Exit.isSuccess(exit)) return exit.value
          throw Cause.squash(exit.cause)
        })
      },
    }) as Promise<R>
  }
  return withInstance(
    input,
    Effect.tryPromise({
      try: fn,
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    }),
  )
}
