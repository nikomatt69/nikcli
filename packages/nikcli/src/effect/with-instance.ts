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

import { Effect } from "effect"
import { AppRuntime } from "./runtime"
import { InstanceScope, type WithInput } from "./instance-scope"
import { instance, type InstanceContext } from "./instance-ref"

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
 * `input.init` is a property of the instance rather than of this call — see
 * `WithInput` — so it is passed straight through to `InstanceScope.with`.
 * There used to be a second implementation here for the `init` case, which
 * reached for `Instance.provide` directly and hand-rolled its own fork onto
 * `AppRuntime`; that meant the busiest callers in the codebase (the HTTP
 * router, the websocket upgrade, workspace connection) took a different
 * bridge from everyone else. They now take the structured one: the inner
 * fiber's full Exit is replayed in the caller's fiber, and interrupting the
 * caller interrupts the inner fiber and waits for its finalizers.
 */
export function withInstanceAsync<R>(input: WithInput, fn: (instance: InstanceContext) => Promise<R>): Promise<R> {
  return withInstance(
    input,
    // The body is handed the context this scope installed, not left to read it
    // back out of the ambient scope. It is the same value either way; the
    // difference is that one of them is written down.
    Effect.flatMap(instance, (context) =>
      Effect.tryPromise({
        try: () => fn(context),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),
    ),
  )
}
