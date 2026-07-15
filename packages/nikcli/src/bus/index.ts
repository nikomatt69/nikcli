import z from "zod"
import { Log } from "../util/log"
import { BusEvent } from "./bus-event"
import { GlobalBus } from "./global"
import { Context, Effect, Layer, Schema } from "effect"
import { InstanceState, runtimeFor, withCurrentInstance } from "@/effect"
import { IslandBridge } from "@/plugin/island/bridge"

export namespace Bus {
  const log = Log.create({ service: "bus" })
  type Subscription = (event: any) => void | Promise<void>

  export const InstanceDisposed = BusEvent.schema(
    "server.instance.disposed",
    Schema.Struct({
      directory: Schema.String,
    }),
  )

  type State = {
    directory: string
    subscriptions: Map<string, Subscription[]>
  }

  export interface Interface {
    publish<Definition extends BusEvent.Definition>(
      def: Definition,
      properties: z.output<Definition["properties"]>,
    ): Effect.Effect<void, unknown>
    subscribe<Definition extends BusEvent.Definition>(
      def: Definition,
      callback: (event: { type: Definition["type"]; properties: z.infer<Definition["properties"]> }) => void,
    ): Effect.Effect<() => void>
    once<Definition extends BusEvent.Definition>(
      def: Definition,
      callback: (event: {
        type: Definition["type"]
        properties: z.infer<Definition["properties"]>
      }) => "done" | undefined,
    ): Effect.Effect<void>
    subscribeAll(callback: (event: any) => void): Effect.Effect<() => void>
  }

  export class Service extends Context.Service<Service, Interface>()("Bus.Service") {}

  const stateEffect = InstanceState.make<State>((ctx) =>
    Effect.gen(function* () {
      const subscriptions = new Map<string, Subscription[]>()
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          const wildcard = subscriptions.get("*")
          if (!wildcard) return
          const event = {
            type: InstanceDisposed.type,
            properties: {
              directory: ctx.directory,
            },
          }
          for (const sub of [...wildcard]) {
            void sub(event)
          }
        }),
      )
      return {
        directory: ctx.directory,
        subscriptions,
      }
    }),
  )

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const state = yield* stateEffect
      const getState = () => InstanceState.get(state)

      function raw(type: string, callback: Subscription) {
        return Effect.gen(function* () {
          log.info("subscribing", { type })
          const subscriptions = (yield* getState()).subscriptions
          const match = subscriptions.get(type) ?? []
          match.push(callback)
          subscriptions.set(type, match)

          return () => {
            log.info("unsubscribing", { type })
            const match = subscriptions.get(type)
            if (!match) return
            const index = match.indexOf(callback)
            if (index === -1) return
            match.splice(index, 1)
          }
        })
      }

      return Service.of({
        publish: (def, properties) =>
          Effect.gen(function* () {
            const current = yield* getState()
            const payload = {
              type: def.type,
              properties,
            }
            log.debug("publishing", {
              type: def.type,
            })
            // Self-activating when opted in, not dependent on any one CLI entrypoint
            // remembering to wire it in: `publish` is the single choke point
            // every session/permission/tool event already flows through, in
            // whichever realm is actually running the session (the TUI's own
            // worker thread, `serve`'s main thread, etc — see IslandBridge's
            // own doc for why that realm distinction matters). Idempotent and
            // a no-op off macOS, so calling it on every publish is cheap.
            IslandBridge.start()
            const pending: Array<void | Promise<void>> = []
            for (const key of [def.type, "*"]) {
              const match = current.subscriptions.get(key)
              for (const sub of match ?? []) {
                pending.push(sub(payload))
              }
            }
            GlobalBus.emit("event", {
              directory: current.directory,
              payload,
            })
            yield* Effect.promise(() => Promise.all(pending).then(() => undefined))
          }),
        subscribe: (def, callback) => raw(def.type, callback),
        once: (def, callback) =>
          Effect.gen(function* () {
            let unsub = () => {}
            unsub = yield* raw(def.type, (event) => {
              if (callback(event)) unsub()
            })
          }),
        subscribeAll: (callback) => raw("*", callback),
      })
    }),
  )

  export const defaultLayer = layer

  function run<A, E>(effect: Effect.Effect<A, E, Service>) {
    return runtimeFor(defaultLayer).runPromise(withCurrentInstance(effect))
  }

  function runSync<A, E>(effect: Effect.Effect<A, E, Service>) {
    return runtimeFor(defaultLayer).runSync(withCurrentInstance(effect))
  }

  export async function publish<Definition extends BusEvent.Definition>(
    def: Definition,
    properties: z.output<Definition["properties"]>,
  ): Promise<void> {
    // Best-effort by contract: most call sites fire-and-forget, so a rejection
    // here must never escape as an unhandled rejection — log it instead.
    return run(
      Effect.gen(function* () {
        const bus = yield* Service
        yield* bus.publish(def, properties)
      }),
    ).catch((error) => {
      log.error("publish failed", { type: def.type, error })
    })
  }

  export function subscribe<Definition extends BusEvent.Definition>(
    def: Definition,
    callback: (event: { type: Definition["type"]; properties: z.infer<Definition["properties"]> }) => void,
  ) {
    return runSync(
      Effect.gen(function* () {
        const bus = yield* Service
        return yield* bus.subscribe(def, callback)
      }),
    )
  }

  export function once<Definition extends BusEvent.Definition>(
    def: Definition,
    callback: (event: {
      type: Definition["type"]
      properties: z.infer<Definition["properties"]>
    }) => "done" | undefined,
  ) {
    return runSync(
      Effect.gen(function* () {
        const bus = yield* Service
        yield* bus.once(def, callback)
      }),
    )
  }

  export function subscribeAll(callback: (event: any) => void) {
    return runSync(
      Effect.gen(function* () {
        const bus = yield* Service
        return yield* bus.subscribeAll(callback)
      }),
    )
  }
}
