import z from "zod"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { BusEvent } from "./bus-event"
import { GlobalBus } from "./global"

export namespace Bus {
  const log = Log.create({ service: "bus" })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Subscription = (event: any) => void

  export const InstanceDisposed = BusEvent.define(
    "server.instance.disposed",
    z.object({
      directory: z.string(),
    }),
  )

  const stateFn = Instance.state(
    () => {
      const subscriptions = new Map<string, Subscription[]>()

      return {
        subscriptions,
      }
    },
    async (entry) => {
      // Notify all subscriptions before clearing
      for (const [_type, subs] of entry.subscriptions) {
        for (const sub of [...subs]) {
          try {
            sub({
              type: InstanceDisposed.type,
              properties: {
                directory: Instance.directory,
              },
            })
          } catch (e) {
            log.error("subscription cleanup error", { error: e })
          }
        }
      }
      // Clear all subscriptions to prevent memory leak
      entry.subscriptions.clear()
    },
  )

  export const state = stateFn

  export async function publish<Definition extends BusEvent.Definition>(
    def: Definition,
    properties: z.output<Definition["properties"]>,
  ) {
    const payload = {
      type: def.type,
      properties,
    }
    log.info("publishing", {
      type: def.type,
    })
    const pending = []
    for (const key of [def.type, "*"]) {
      const match = state().subscriptions.get(key)
      for (const sub of match ?? []) {
        pending.push(sub(payload))
      }
    }
    GlobalBus.emit("event", {
      directory: Instance.directory,
      payload,
    })
    return Promise.all(pending)
  }

  export function subscribe<Definition extends BusEvent.Definition>(
    def: Definition,
    callback: (event: { type: Definition["type"]; properties: z.infer<Definition["properties"]> }) => void,
  ) {
    return raw(def.type, callback)
  }

  export function once<Definition extends BusEvent.Definition>(
    def: Definition,
    callback: (event: {
      type: Definition["type"]
      properties: z.infer<Definition["properties"]>
    }) => "done" | undefined,
  ) {
    const unsub = subscribe(def, (event) => {
      if (callback(event)) unsub()
    })
  }

  export function subscribeAll(callback: (event: unknown) => void) {
    return raw("*", callback)
  }

  function raw(type: string, callback: Subscription) {
    log.info("subscribing", { type })
    const subs = state().subscriptions
    const match = subs.get(type) ?? []
    match.push(callback)
    subs.set(type, match)

    return () => {
      log.info("unsubscribing", { type })
      const match = subs.get(type)
      if (!match) return
      const index = match.indexOf(callback)
      if (index === -1) return
      match.splice(index, 1)
      // Clean up empty arrays to prevent memory growth
      if (match.length === 0) {
        subs.delete(type)
      }
    }
  }
}
