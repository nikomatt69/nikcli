import type { Effect, Layer } from "effect"
import { runPromiseWithLayer } from "./runtime"

type ServiceModule<R> = {
  readonly defaultLayer: Layer.Layer<R, unknown, never>
}

/**
 * Run an Effect with a module's `defaultLayer` (e.g. `Session`, `Project`).
 *
 * `R` is shared between the layer and the effect, so a caller that passes a
 * module whose layer does not provide what the effect requires fails to
 * compile. This used to be `Layer.Layer<any, any, never>` plus a cast, which
 * type-checked every mismatch.
 */
export function runService<R, A, E>(
  module: ServiceModule<R>,
  effect: Effect.Effect<A, E, R>,
  wrap?: (effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>,
): Promise<A> {
  const run = wrap ? wrap(effect) : effect
  return runPromiseWithLayer(module.defaultLayer, run)
}
