import { createNikcliClient, type Event } from "@nikcli-ai/sdk/v2"
import { createSimpleContext } from "./helper"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { batch, onCleanup, onMount } from "solid-js"

export type EventSource = {
  subscribe: (directory: string | undefined, handler: (event: Event) => void) => Promise<() => void>
}

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: { url: string; directory?: string; fetch?: typeof fetch; events?: EventSource }) => {
    const abort = new AbortController()
    let sse: AbortController | undefined

    function createSDK() {
      return createNikcliClient({
        baseUrl: props.url,
        signal: abort.signal,
        directory: props.directory,
        fetch: props.fetch,
      })
    }

    let sdk = createSDK()

    const emitter = createGlobalEmitter<{
      [key in Event["type"]]: Extract<Event, { type: key }>
    }>()

    // Cap the in-flight event queue to avoid unbounded memory growth under load.
    const MAX_QUEUE_SIZE = 500

    let queue: Event[] = []
    let timer: Timer | undefined
    let last = 0

    const flush = () => {
      if (queue.length === 0) return
      const events = queue
      queue = []
      timer = undefined
      last = Date.now()
      // Batch all event emissions so all store updates result in a single render
      batch(() => {
        for (const event of events) {
          emitter.emit(event.type, event)
        }
      })
    }

    const handleEvent = (event: Event) => {
      // Drop the oldest event when the queue is full rather than growing without bound
      if (queue.length >= MAX_QUEUE_SIZE) {
        queue.shift()
      }
      queue.push(event)
      const elapsed = Date.now() - last

      if (timer) return
      // If we just flushed recently (within 16ms), batch this with future events
      // Otherwise, process immediately to avoid latency
      if (elapsed < 16) {
        timer = setTimeout(flush, 16)
        return
      }
      flush()
    }

    function startSSE() {
      sse?.abort()
      const ctrl = new AbortController()
      sse = ctrl
      ;(async () => {
        let backoff = 1000
        while (true) {
          if (abort.signal.aborted || ctrl.signal.aborted) break

          try {
            const events = await sdk.event.subscribe(
              {},
              {
                signal: ctrl.signal,
              },
            )

            // Reset backoff on a successful connection
            backoff = 1000

            for await (const event of events.stream) {
              if (ctrl.signal.aborted) break
              handleEvent(event)
            }
          } catch {
            // Stream error — wait before reconnecting (exponential backoff, max 30s)
            if (abort.signal.aborted || ctrl.signal.aborted) break
            await new Promise<void>((res) => setTimeout(res, backoff))
            backoff = Math.min(backoff * 2, 30_000)
            continue
          }

          if (timer) clearTimeout(timer)
          if (queue.length > 0) flush()
        }
      })().catch(() => {})
    }

    onMount(async () => {
      if (props.events) {
        const unsub = await props.events.subscribe(props.directory, handleEvent)
        onCleanup(unsub)
        return
      }

      startSSE()
    })

    onCleanup(() => {
      abort.abort()
      sse?.abort()
      if (timer) clearTimeout(timer)
    })

    return {
      get client() {
        return sdk
      },
      directory: props.directory,
      event: emitter,
      fetch: props.fetch ?? fetch,
      url: props.url,
    }
  },
})
