/**
 * Shared test helper for Effect-based service tests.
 *
 * Replaces the pattern:
 * ```ts
 * function runX<A, E>(effect: Effect.Effect<A, E, any>) {
 *   return runPromiseWithLayer(X.defaultLayer, withCurrentInstance(effect))
 * }
 * ```
 * with a reusuable `runTest` that works for any layer.
 *
 * Usage:
 * ```ts
 * import { Effect } from "effect"
 * import { makeTestRuntime } from "../helpers/effect-test"
 * import { X } from "@/x"
 *
 * const { run } = makeTestRuntime("X", X.defaultLayer)
 *
 * it("does something", async () => {
 *   const result = await run(
 *     Effect.fn("test")(function* () {
 *       const x = yield* X.Service
 *       return yield* x.something()
 *     }),
 *   )
 * })
 * ```
 */
import { Effect, ManagedRuntime } from "effect"

export function makeTestRuntime<A, E>(label: string, layer: import("effect").Layer.Layer<A, E, never>) {
  const runtime = ManagedRuntime.make(layer)

  /** Run the effect through the managed runtime, returning the value. */
  const run = <R>(effect: Effect.Effect<A, E, R>) => runtime.runPromise(effect as Effect.Effect<A, E, any>)

  /** Run the effect through the managed runtime, returning the Exit. */
  const runExit = <R>(effect: Effect.Effect<A, E, R>) => runtime.runPromiseExit(effect as Effect.Effect<A, E, any>)

  return { run, runExit }
}
