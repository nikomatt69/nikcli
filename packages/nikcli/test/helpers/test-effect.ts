import { Effect, ManagedRuntime } from "effect"
import { it } from "bun:test"

/**
 * Creates a `ManagedRuntime` for a layer under test.
 * Callers must provide their own layer composition.
 *
 * Example:
 * ```ts
 * const { runTest } = makeTestRuntime("TestAgent", Agent.defaultLayer)
 * runTest(Effect.fn("test")(function* () {
 *   const service = yield* Agent.Service
 *   return yield* service.list()
 * }))
 * ```
 */
export function makeTestRuntime<A, E>(
  label: string,
  layer: import("effect").Layer.Layer<A, E, never>,
) {
  const runtime = ManagedRuntime.make(layer)

  const runTest = <R>(effect: Effect.Effect<A, E, R>) =>
    runtime.runPromise(effect as Effect.Effect<A, E, any>)

  const runTestExit = <R>(effect: Effect.Effect<A, E, R>) =>
    runtime.runPromiseExit(effect as Effect.Effect<A, E, any>)

  return { runTest, runTestExit, runtime }
}

/**
 * Wraps `it` with a `ManagedRuntime` pre-baked layer.
 * Each test gets a fresh instance.
 */
export function itWithRuntime<A, E>(
  label: string,
  layer: import("effect").Layer.Layer<A, E, never>,
) {
  const { runTest, runTestExit } = makeTestRuntime(label, layer)

  return {
    it: (name: string, fn: (ctx: { runTest: typeof runTest; runTestExit: typeof runTestExit }) => Promise<void>) =>
      it(name, () => fn({ runTest, runTestExit })),
  }
}