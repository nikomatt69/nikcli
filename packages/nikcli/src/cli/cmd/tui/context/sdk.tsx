import { createNikcliClient, type Event } from "@nikcli-ai/sdk/v2"
import { createSimpleContext } from "./helper"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { batch, createSignal, onCleanup, onMount } from "solid-js"
import { createWakeDedup, type WakeDedup } from "../util/wake-dedup"

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

    // Server-connection state surfaced to the UI (reconnecting banner).
    // Driven by the SSE retry loop below, or by the embedded-events path.
    const [connected, setConnected] = createSignal(false)
    const [attempt, setAttempt] = createSignal(0)
    const [error, setError] = createSignal<string | undefined>()
    const status = (): "connecting" | "connected" | "reconnecting" =>
      connected() ? "connected" : attempt() > 0 ? "reconnecting" : "connecting"

    const markConnected = () => {
      batch(() => {
        setConnected(true)
        setAttempt(0)
        setError(undefined)
      })
      markSubscriptionReady()
    }

    const markDisconnected = (cause?: unknown) => {
      setConnected(false)
      if (cause === undefined) return
      setAttempt((n) => n + 1)
      setError(cause instanceof Error ? cause.message : String(cause))
    }

    const emitter = createGlobalEmitter<{
      [key in Event["type"]]: Extract<Event, { type: key }>
    }>()

    const envelopeHandlers = new Set<(envelope: GlobalEnvelope) => void>()

    let queue: GlobalEnvelope[] = []
    let timer: Timer | undefined
    let last = 0

    // Consumer-side dedup for wake-shaped envelopes. The "parent ↔
    // child wake ordering race" can cause the same event to be
    // delivered twice through the bus; without this filter every
    // handler below would re-run on the duplicate (e.g. two
    // refreshBackgroundJobs, two "Woke parent session" log lines).
    // The LRU is bounded to 256 entries × 60s TTL (~8 KB) so it cannot
    // grow unbounded even under sustained bursts. See
    // `util/wake-dedup.ts` for the policy and Level-2 follow-ups.
    const wakeDedup: WakeDedup = createWakeDedup(
      (envelope) => {
        const payload = (envelope as { payload?: { type?: string; properties?: unknown } }).payload
        const type = payload?.type
        const props = (payload?.properties ?? {}) as Record<string, unknown>
        switch (type) {
          case "delegation.completed":
            return `delegation:${props?.delegationID}:${props?.status}`
          case "loop.run.finished":
            return `loop:${props?.runID}:${props?.status}`
          case "loop.runtime.changed":
            return `loop-runtime:${props?.loopID}`
          case "mission.finished":
            return `mission:${props?.missionID}`
          case "mission.exec.finished":
            return `mission-exec:${props?.execID}:${props?.status}`
          case "session.goal":
            return `goal:${props?.sessionID}:${(props?.goal as { status?: string } | null)?.status ?? "null"}`
          default:
            return undefined
        }
      },
      { maxEntries: 256, ttlMs: 60_000 },
    )

    const flush = () => {
      if (queue.length === 0) return
      const envelopes = queue
      queue = []
      timer = undefined
      last = Date.now()
      // Filter wake-shaped envelopes that have already been seen in
      // the dedup window. The filter is O(n) over the queue and runs
      // before the batch, so the rest of the pipeline (handlers,
      // emitter) sees only fresh envelopes.
      const fresh: GlobalEnvelope[] = []
      for (const envelope of envelopes) {
        if (wakeDedup.shouldProcess(envelope as { type?: string; properties?: unknown })) {
          fresh.push(envelope)
        }
      }
      if (fresh.length === 0) return
      // Batch all event emissions so all store updates result in a single render
      batch(() => {
        for (const envelope of fresh) {
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
                onConnected: markConnected,
                onEnvelope: handleEnvelope,
              })

              if (timer) clearTimeout(timer)
              if (queue.length > 0) flush()
              // The stream ended without an error (server closed it) and the
              // loop is about to reconnect — just note the drop.
              if (!ctrl.signal.aborted && !abort.signal.aborted) setConnected(false)
            } catch (loopError) {
              if (ctrl.signal.aborted || abort.signal.aborted) break
              console.warn(
                "[sse]",
                "subscribe failed, retrying in",
                backoff,
                "ms",
                loopError instanceof Error ? loopError.message : loopError,
              )
              markDisconnected(loopError)
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
          markDisconnected(error)
          return
        }
        void subscription
          .then((unsub) => {
            if (!active) {
              unsub()
              return
            }
            unsubscribe = unsub
            markConnected()
          })
          .catch((error) => {
            if (!active) return
            console.error("[events]", "subscribe failed", error)
            markDisconnected(error)
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
      /** Live server-connection state, for surfacing reconnect UI. */
      connection: {
        connected,
        attempt,
        error,
        status,
      },
    }
  },
})
