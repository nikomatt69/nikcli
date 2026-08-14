import { Log } from "@nikcli-ai/util/log"
import type z from "zod"
import type { BusEvent } from "../bus/bus-event"
import { Bus } from "../bus"

export namespace EventLoop {
  export async function wait() {
    return new Promise<void>((resolve) => {
      const check = () => {
        const active = [...(process as any)._getActiveHandles(), ...(process as any)._getActiveRequests()]
        Log.Default.info("eventloop", {
          active,
        })
        if ((process as any)._getActiveHandles().length === 0 && (process as any)._getActiveRequests().length === 0) {
          resolve()
        } else {
          setImmediate(check)
        }
      }
      check()
    })
  }

  export async function waitEvent<D extends BusEvent.Definition>(options: {
    event: D
    timeoutMs: number
    predicate?: (properties: z.infer<D["properties"]>) => boolean
    signal?: AbortSignal
  }): Promise<z.infer<D["properties"]>> {
    const { event, timeoutMs, predicate, signal } = options
    if (signal?.aborted) {
      throw signal.reason ?? new Error("Request aborted")
    }
    return new Promise<z.infer<D["properties"]>>((resolve, reject) => {
      let cleanup = () => {}
      const onAbort = () => {
        cleanup()
        reject(signal?.reason ?? new Error("Request aborted"))
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error(`Timed out waiting for event "${event.type}"`))
      }, timeoutMs)
      const unsubscribe = Bus.subscribe(event, (ev) => {
        try {
          if (predicate && !predicate(ev.properties)) return
          cleanup()
          resolve(ev.properties)
        } catch (err) {
          cleanup()
          reject(err)
        }
      })
      cleanup = () => {
        clearTimeout(timer)
        unsubscribe()
        signal?.removeEventListener("abort", onAbort)
      }
      signal?.addEventListener("abort", onAbort, { once: true })
    })
  }
}
