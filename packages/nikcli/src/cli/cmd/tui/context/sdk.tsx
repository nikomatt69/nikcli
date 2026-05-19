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
      let backoff = 250
      const maxBackoff = 5000
      void (async () => {
        try {
          while (true) {
            if (abort.signal.aborted || ctrl.signal.aborted) break
            try {
              const events = await sdk.event.subscribe(
                {},
                {
                  signal: ctrl.signal,
                },
              )

              // successful connect → reset backoff
              backoff = 250

              for await (const event of events.stream) {
                if (ctrl.signal.aborted) break
                try {
                  handleEvent(event)
                } catch (handlerError) {
                  console.error("[sse]", "handleEvent threw", handlerError)
                }
              }

              if (timer) clearTimeout(timer)
              if (queue.length > 0) flush()
            } catch (loopError) {
              if (ctrl.signal.aborted || abort.signal.aborted) break
              console.warn("[sse]", "subscribe failed, retrying in", backoff, "ms",
                loopError instanceof Error ? loopError.message : loopError)
              await Bun.sleep(backoff)
              backoff = Math.min(backoff * 2, maxBackoff)
            }
          }
        } catch (fatalError) {
          // Should never happen — the outer try is a safety net so an
          // unhandled rejection here can't crash the TUI process.
          console.error("[sse]", "fatal loop error", fatalError)
        }
      })()
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
