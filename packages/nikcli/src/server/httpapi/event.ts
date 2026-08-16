import { Bus } from "@/bus"
import { GlobalBus } from "@nikcli-ai/util/global-bus"
import { Instance } from "@/project/instance"
import { Log } from "@nikcli-ai/util/log"
import { EventFeed } from "./event-feed"

/**
 * GET /event for the Effect backend — the same SSE contract as the Hono
 * `routes/global.ts` handler (server.connected greeting, GlobalBus
 * forwarding, 30s heartbeat against WKWebView's 60s idle timeout), built
 * on a web-standard ReadableStream so the fallback window has no Hono
 * dependency. Served by the bridge ahead of the HttpApi router because
 * SSE is a raw streaming response, not a schema-encoded body.
 *
 * Both routes fan out through an `EventFeed`: one subscription and one
 * encode per event regardless of how many clients are attached, and one lag
 * budget per client. See `specs/v2/event-stream-architecture.md`.
 */
export namespace HttpApiEvent {
  const log = Log.create({ service: "httpapi.event" })

  const HEARTBEAT_MS = 30_000

  /**
   * One feed per instance, created with the first connection and torn down
   * with the last. Sharing it is what makes the encode O(1) in connections:
   * a second client to the same directory reuses the subscription rather
   * than adding one.
   */
  const instanceFeeds = new Map<string, { feed: EventFeed.Feed; unsubscribe: () => void }>()

  /** The instance stream sends payloads unwrapped. */
  const instanceEnvelope: EventFeed.Envelope = (event) => event

  /** The global stream wraps everything in `{payload}`. */
  const globalEnvelope: EventFeed.Envelope = (event) => ({ payload: event })

  /**
   * `GlobalBus` emits `{ directory?, payload }` — already wrapped — so the
   * visibility filter has to reach one level in. The instance feed keeps the
   * default extractor because `Bus.subscribeAll` hands over the bare event.
   */
  const globalTypeOf: EventFeed.TypeOf = (event) =>
    (event as { payload?: { type?: string } } | undefined)?.payload?.type

  function instanceFeed(directory: string) {
    const existing = instanceFeeds.get(directory)
    if (existing) return existing.feed

    const feed = new EventFeed.Feed(instanceEnvelope)
    // `Bus.subscribeAll` reads the current instance at subscription time, so
    // this must stay synchronous inside the caller's instance ALS. Moving it
    // into a fiber breaks instance binding.
    const unsubscribe = Bus.subscribeAll((event: { type?: string }) => {
      feed.broadcast(event)
      if (event.type === Bus.InstanceDisposed.type) {
        releaseInstanceFeed(directory)
        feed.closeAll()
      }
    })
    instanceFeeds.set(directory, { feed, unsubscribe })
    return feed
  }

  function releaseInstanceFeed(directory: string) {
    const entry = instanceFeeds.get(directory)
    if (!entry) return
    instanceFeeds.delete(directory)
    entry.unsubscribe()
  }

  /**
   * GET /event — instance-scoped SSE, same wire contract as the Hono
   * `server.ts` handler: unwrapped `{type, properties}` payloads from the
   * instance `Bus` (NOT the `{payload}`-wrapped GlobalBus shape of
   * `/global/event`), `server.connected` greeting, 30s heartbeat, stream
   * closed on `server.instance.disposed`. The TUI parses `data.type`
   * directly, so serving the global envelope here silently drops every
   * event client-side.
   *
   * Must be called synchronously within the instance ALS (the bridge runs
   * inside the Hono instance middleware) — the feed's `Bus.subscribeAll`
   * reads the current instance at subscription time.
   */
  export function handleInstance(): Response {
    log.info("event connected")
    // Read the instance key in the caller's scope, not inside the stream.
    const directory = Instance.directory
    const feed = instanceFeed(directory)

    let connection: EventFeed.Connection | undefined
    let heartbeat: ReturnType<typeof setInterval> | undefined

    const stream = EventFeed.stream({
      // `start` runs synchronously at construction, so the caller's instance
      // ALS is still active here.
      start(controller) {
        connection = feed.attach(controller, () => {
          if (heartbeat) clearInterval(heartbeat)
          heartbeat = undefined
          if (feed.size === 0) releaseInstanceFeed(directory)
          log.info("event disconnected")
        })
        connection.local({ type: "server.connected", properties: {} })
        heartbeat = setInterval(() => {
          connection?.local({ type: "server.heartbeat", properties: {} })
        }, HEARTBEAT_MS)
      },
      cancel() {
        connection?.abandon()
      },
    })

    return new Response(stream, { headers: { ...EventFeed.HEADERS } })
  }

  /**
   * GET /global/event — cross-instance SSE. It sits outside the instance
   * middleware on purpose: clients track several directories at once, so the
   * feed must not filter by request instance.
   *
   * One `GlobalBus` listener serves every connection, which also keeps this
   * route from ever being the source of a `MaxListenersExceededWarning`.
   */
  const globalFeed = new EventFeed.Feed(globalEnvelope, globalTypeOf)
  let globalListener: ((event: unknown) => void) | undefined

  function attachGlobalListener() {
    if (globalListener) return
    globalListener = (event) => globalFeed.broadcast(event)
    GlobalBus.on("event", globalListener as never)
  }

  function detachGlobalListener() {
    if (!globalListener) return
    GlobalBus.off("event", globalListener as never)
    globalListener = undefined
  }

  export function handle(): Response {
    log.info("global event connected")
    attachGlobalListener()

    let connection: EventFeed.Connection | undefined
    let heartbeat: ReturnType<typeof setInterval> | undefined

    const stream = EventFeed.stream({
      start(controller) {
        connection = globalFeed.attach(controller, () => {
          if (heartbeat) clearInterval(heartbeat)
          heartbeat = undefined
          if (globalFeed.size === 0) detachGlobalListener()
          log.info("global event disconnected")
        })
        connection.local({ type: "server.connected", properties: {} })
        heartbeat = setInterval(() => {
          connection?.local({ type: "server.heartbeat", properties: {} })
        }, HEARTBEAT_MS)
      },
      cancel() {
        connection?.abandon()
      },
    })

    return new Response(stream, { headers: { ...EventFeed.HEADERS } })
  }
}
