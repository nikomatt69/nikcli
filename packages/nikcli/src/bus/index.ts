import z from "zod"
import { Log } from "../util/log"
import { BusEvent } from "./bus-event"
import { GlobalBus } from "./global"
import { Context, Effect, Layer } from "effect"
import { InstanceState, runtimeFor, withCurrentInstance } from "@/effect"

export namespace Bus {
  const log = Log.create({ service: "bus" })
  type Subscription = (event: any) => void | Promise<void>

  export const InstanceDisposed = BusEvent.define(
    "server.instance.disposed",
    z.object({
      directory: z.string(),
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

  export class Service extends Context.Tag("Bus.Service")<Service, Interface>() {}

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

  export const layer = Layer.scoped(
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
  ) {
    return run(
      Effect.gen(function* () {
        const bus = yield* Service
        yield* bus.publish(def, properties)
      }),
    )
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
