import { Bus } from "@/bus"
import { GlobalBus } from "@/bus/global"
import { Log } from "@/util/log"

/**
 * GET /event for the Effect backend — the same SSE contract as the Hono
 * `routes/global.ts` handler (server.connected greeting, GlobalBus
 * forwarding, 30s heartbeat against WKWebView's 60s idle timeout), built
 * on a web-standard ReadableStream so the fallback window has no Hono
 * dependency. Served by the bridge ahead of the HttpApi router because
 * SSE is a raw streaming response, not a schema-encoded body.
 */
export namespace HttpApiEvent {
  const log = Log.create({ service: "httpapi.event" })

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
   * inside the Hono instance middleware) — `Bus.subscribeAll` reads the
   * current instance at subscription time.
   */
  export function handleInstance(): Response {
    log.info("event connected")
    const encoder = new TextEncoder()
    let unsub: (() => void) | undefined
    let heartbeat: ReturnType<typeof setInterval> | undefined

    const cleanup = () => {
      if (heartbeat) clearInterval(heartbeat)
      unsub?.()
      heartbeat = undefined
      unsub = undefined
      log.info("event disconnected")
    }

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (data: unknown) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
          } catch (error) {
            log.debug("sse write failed", { error })
            cleanup()
          }
        }
        send({ type: "server.connected", properties: {} })
        // ReadableStream `start` runs synchronously at construction, so the
        // instance ALS from the caller is still active here.
        unsub = Bus.subscribeAll(async (event) => {
          send(event)
          if (event.type === Bus.InstanceDisposed.type) {
            cleanup()
            try {
              controller.close()
            } catch {
              // already closed by the client
            }
          }
        })
        heartbeat = setInterval(() => {
          send({ type: "server.heartbeat", properties: {} })
        }, 30_000)
      },
      cancel() {
        cleanup()
      },
    })

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    })
  }

  export function handle(): Response {
    log.info("global event connected")
    const encoder = new TextEncoder()
    let handler: ((event: unknown) => void) | undefined
    let heartbeat: ReturnType<typeof setInterval> | undefined

    const cleanup = () => {
      if (heartbeat) clearInterval(heartbeat)
      if (handler) GlobalBus.off("event", handler as never)
      heartbeat = undefined
      handler = undefined
      log.info("global event disconnected")
    }

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (data: unknown) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
          } catch (error) {
            // Closed by the client between the cancel callback and this write.
            log.debug("sse write failed", { error })
            cleanup()
          }
        }
        send({ payload: { type: "server.connected", properties: {} } })
        handler = (event) => send(event)
        GlobalBus.on("event", handler as never)
        heartbeat = setInterval(() => {
          send({ payload: { type: "server.heartbeat", properties: {} } })
        }, 30_000)
      },
      cancel() {
        cleanup()
      },
    })

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    })
  }
}
