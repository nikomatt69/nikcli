import type { Effect, Layer } from "effect"
import { runPromiseWithLayer } from "./runtime"

type ServiceModule = {
  readonly defaultLayer: Layer.Layer<any, any, never>
}

/** Run an Effect with a module's `defaultLayer` (e.g. `Session`, `Project`). */
export function runService<R, A, E>(
  module: ServiceModule,
  effect: Effect.Effect<A, E, R>,
  wrap?: (effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>,
): Promise<A> {
  const run = wrap ? wrap(effect) : effect
  return runPromiseWithLayer(module.defaultLayer, run as Effect.Effect<A, E, any>)
}
