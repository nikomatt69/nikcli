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
