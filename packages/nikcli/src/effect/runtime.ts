import { Instance } from "@/project/instance"
import { Effect, Layer, ManagedRuntime } from "effect"
import { locallyInstance, type InstanceContext } from "./instance-ref"

export const sharedMemoMap = Effect.runSync(Layer.makeMemoMap)
const runtimes = new WeakMap<Layer.Layer<any, any, never>, ManagedRuntime.ManagedRuntime<any, any>>()

export function makeRuntime<R, E>(layer: Layer.Layer<R, E, never>) {
  return ManagedRuntime.make(layer, sharedMemoMap)
}

export const AppRuntime = makeRuntime(Layer.empty)

export function runtimeFor<R, E>(layer: Layer.Layer<R, E, never>) {
  let runtime = runtimes.get(layer) as ManagedRuntime.ManagedRuntime<R, E> | undefined
  if (!runtime) {
    runtime = makeRuntime(layer)
    runtimes.set(layer, runtime)
  }
  return runtime
}

export function runPromiseWithLayer<A, E, R, LE>(
  layer: Layer.Layer<R, LE, never>,
  effect: Effect.Effect<A, E, R>,
) {
  return runtimeFor(layer).runPromise(effect)
}

export function runPromiseExitWithLayer<A, E, R, LE>(
  layer: Layer.Layer<R, LE, never>,
  effect: Effect.Effect<A, E, R>,
) {
  return runtimeFor(layer).runPromiseExit(effect)
}

export function withCurrentInstance<A, E, R>(effect: Effect.Effect<A, E, R>) {
  const ctx: InstanceContext = {
    directory: Instance.directory,
    worktree: Instance.worktree,
    project: Instance.project,
  }
  return locallyInstance(ctx, effect)
}

export function runPromise<A, E>(effect: Effect.Effect<A, E, never>) {
  return AppRuntime.runPromise(effect)
}
