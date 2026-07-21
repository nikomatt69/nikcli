import { createNikcliClient, type Event } from "@nikcli-ai/sdk/v2"
import { createSimpleContext } from "./helper"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { batch, onCleanup, onMount } from "solid-js"

/**
 * GlobalBus envelope as forwarded by `/global/event` (HTTP mode) and the
 * worker's `global.event` RPC channel (embedded mode). `directory` is the
 * instance directory the event was published on — worktree instances carry
 * their worktree path here, which is how workspace-session events are told
 * apart from root-instance events (opencode parity: the TUI listens to the
 * global stream and filters client-side, instead of an instance-scoped SSE
 * that would never see worktree events).
 */
export type GlobalEnvelope = {
  directory?: string
  payload: Event
}

export type EventSource = {
  subscribe: (directory: string | undefined, handler: (event: GlobalEnvelope) => void) => Promise<() => void>
}

export async function checkUpgradeWhenSubscriptionReady(
  subscriptionReady: Promise<void>,
  checkUpgrade: (() => Promise<void>) | undefined,
) {
  await subscriptionReady
  await checkUpgrade?.()
}

export async function consumeGlobalEventStream(input: {
  stream: AsyncIterable<GlobalEnvelope>
  signal: AbortSignal
  onConnected: () => void
  onEnvelope: (envelope: GlobalEnvelope) => void
}) {
  for await (const envelope of input.stream) {
    if (input.signal.aborted) break
    try {
      if (envelope?.payload?.type === "server.connected") input.onConnected()
      input.onEnvelope(envelope)
    } catch (error) {
      console.error("[sse]", "handleEnvelope threw", error)
    }
  }
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
    let resolveSubscriptionReady!: () => void
    const subscriptionReady = new Promise<void>((resolve) => {
      resolveSubscriptionReady = resolve
    })
    let subscriptionReadyResolved = false
    const markSubscriptionReady = () => {
      if (subscriptionReadyResolved) return
      subscriptionReadyResolved = true
      resolveSubscriptionReady()
    }

    const emitter = createGlobalEmitter<{
      [key in Event["type"]]: Extract<Event, { type: key }>
    }>()

    const envelopeHandlers = new Set<(envelope: GlobalEnvelope) => void>()

    let queue: GlobalEnvelope[] = []
    let timer: Timer | undefined
    let last = 0

    const flush = () => {
      if (queue.length === 0) return
      const envelopes = queue
      queue = []
      timer = undefined
      last = Date.now()
      // Batch all event emissions so all store updates result in a single render
      batch(() => {
        for (const envelope of envelopes) {
          for (const handler of envelopeHandlers) handler(envelope)
          emitter.emit(envelope.payload.type, envelope.payload)
        }
      })
    }

    const handleEnvelope = (envelope: GlobalEnvelope) => {
      const type = (envelope?.payload as { type?: string } | undefined)?.type
      if (!type) return
      if (type === "server.heartbeat" || type === "server.connected") return
      queue.push(envelope)
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
              // Global stream: events from every instance (root + worktrees)
              // wrapped in {directory, payload} envelopes.
              const events = await sdk.global.event({
                signal: ctrl.signal,
              })
              // successful connect → reset backoff
              backoff = 250

              await consumeGlobalEventStream({
                stream: events.stream as AsyncIterable<GlobalEnvelope>,
                signal: ctrl.signal,
                onConnected: markSubscriptionReady,
                onEnvelope: handleEnvelope,
              })

              if (timer) clearTimeout(timer)
              if (queue.length > 0) flush()
            } catch (loopError) {
              if (ctrl.signal.aborted || abort.signal.aborted) break
              console.warn(
                "[sse]",
                "subscribe failed, retrying in",
                backoff,
                "ms",
                loopError instanceof Error ? loopError.message : loopError,
              )
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

    onMount(() => {
      if (props.events) {
        let active = true
        let unsubscribe: (() => void) | undefined
        onCleanup(() => {
          active = false
          unsubscribe?.()
        })

        let subscription: Promise<() => void>
        try {
          subscription = props.events.subscribe(props.directory, handleEnvelope)
        } catch (error) {
          console.error("[events]", "subscribe failed", error)
          return
        }
        void subscription
          .then((unsub) => {
            if (!active) {
              unsub()
              return
            }
            unsubscribe = unsub
            markSubscriptionReady()
          })
          .catch((error) => {
            if (!active) return
            console.error("[events]", "subscribe failed", error)
          })
        return
      }

      startSSE()
    })

    onCleanup(() => {
      abort.abort()
      sse?.abort()
      if (timer) clearTimeout(timer)
      envelopeHandlers.clear()
    })

    return {
      get client() {
        return sdk
      },
      directory: props.directory,
      event: emitter,
      /** Subscribe to raw {directory, payload} envelopes when the consumer
       *  needs to know which instance emitted the event (e.g. vcs updates). */
      onEnvelope(handler: (envelope: GlobalEnvelope) => void) {
        envelopeHandlers.add(handler)
        return () => {
          envelopeHandlers.delete(handler)
        }
      },
      fetch: props.fetch ?? fetch,
      url: props.url,
      subscriptionReady,
    }
  },
})
