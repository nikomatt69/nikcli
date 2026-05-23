import { Instance } from "@/project/instance"
import { Effect, Layer, ManagedRuntime, Option } from "effect"
import { InstanceRef, locallyInstance, type InstanceContext } from "./instance-ref"

export const sharedMemoMap = Effect.runSync(Layer.makeMemoMap)
const runtimes = new WeakMap<Layer.Layer<any, any, never>, ManagedRuntime.ManagedRuntime<any, any>>()

export function makeRuntime<R, E>(layer: Layer.Layer<R, E, never>) {
  return ManagedRuntime.make(layer, { memoMap: sharedMemoMap })
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
  layer: Layer.Layer<any, LE, never>,
  effect: Effect.Effect<A, E, R>,
): Promise<A> {
  return runtimeFor(layer).runPromise(effect as Effect.Effect<A, E, any>)
}

export function runPromiseExitWithLayer<A, E, R, LE>(
  layer: Layer.Layer<any, LE, never>,
  effect: Effect.Effect<A, E, R>,
): Promise<import("effect").Exit.Exit<A, E | LE>> {
  return runtimeFor(layer).runPromiseExit(effect as Effect.Effect<A, E, any>)
}

export function withCurrentInstance<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const fiberCtx = yield* Effect.serviceOption(InstanceRef)
    if (Option.isSome(fiberCtx)) {
      return yield* effect
    }
    const ctx: InstanceContext = {
      directory: Instance.directory,
      worktree: Instance.worktree,
      project: Instance.project,
    }
    return yield* locallyInstance(ctx, effect)
  }) as Effect.Effect<A, E, R>
}

export function runPromise<A, E>(effect: Effect.Effect<A, E, never>): Promise<A> {
  return AppRuntime.runPromise(effect)
}
