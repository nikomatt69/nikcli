import { Instance } from "@/project/instance"
import { Observability } from "@/observability"
import { Log } from "@nikcli-ai/util/log"
import { Cause, Effect, Layer, Logger, ManagedRuntime, Option } from "effect"
import { InstanceRef, locallyInstance, type InstanceContext } from "./instance-ref"

export const sharedMemoMap = Effect.runSync(Layer.makeMemoMap)
const runtimes = new WeakMap<Layer.Layer<any, any, never>, Map<string, ManagedRuntime.ManagedRuntime<any, any>>>()

// Effect's default logger writes to the console, which corrupts the TUI when
// runtime-internal logs fire (e.g. HttpApi span/error logs from the bridge).
// Route Effect-emitted logs into nikcli's `Log` sink instead — a file in TUI
// mode, stderr only when `--print-logs` is set.
const effectLog = Log.create({ service: "effect" })
export const LogRedirect = Logger.layer([
  Logger.make(({ message, logLevel, cause }) => {
    const text = Array.isArray(message) ? message.map((part) => String(part)).join(" ") : String(message)
    const line = cause.reasons.length > 0 ? `${text} ${Cause.pretty(cause)}` : text
    switch (logLevel) {
      case "Fatal":
      case "Error":
        effectLog.error(line)
        break
      case "Warn":
        effectLog.warn(line)
        break
      case "Debug":
      case "Trace":
        effectLog.debug(line)
        break
      default:
        effectLog.info(line)
    }
  }),
])

export function makeRuntime<R, E>(layer: Layer.Layer<R, E, never>) {
  // Merge OTLP observability into every runtime base. Memoised via the shared
  // memo map, so a single exporter/HttpClient is built and reused. No-op when
  // no OTEL endpoint is configured. `LogRedirect` replaces the console default
  // logger; the OTLP logger layer merges with whatever loggers are current.
  return ManagedRuntime.make(Layer.mergeAll(layer, LogRedirect, Observability.layer), { memoMap: sharedMemoMap })
}

export const AppRuntime = makeRuntime(Layer.empty)

function runtimeScope() {
  if (process.env.NIKCLI_TEST_MODE !== "1") return "default"
  return [process.env.NIKCLI_TEST_HOME ?? "", process.env.NIKCLI_DB ?? ""].join("\0")
}

export function runtimeFor<R, E>(layer: Layer.Layer<R, E, never>) {
  let scoped = runtimes.get(layer)
  if (!scoped) {
    scoped = new Map()
    runtimes.set(layer, scoped)
  }
  const scope = runtimeScope()
  let runtime = scoped.get(scope) as ManagedRuntime.ManagedRuntime<R, E> | undefined
  if (!runtime) {
    runtime = makeRuntime(layer)
    scoped.set(scope, runtime)
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
