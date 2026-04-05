import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { GlobalBus } from "../../bus/global"

export function WorkspaceServerRoutes() {
  return new Hono().get("/event", async (c) => {
    c.header("X-Accel-Buffering", "no")
    c.header("X-Content-Type-Options", "nosniff")
    return streamSSE(c, async (stream) => {
      const send = async (event: unknown) => {
        await stream.writeSSE({
          data: JSON.stringify(event),
        })
      }
      const handler = async (event: { directory?: string; payload: unknown }) => {
        await send(event.payload)
      }

      let heartbeat: ReturnType<typeof setInterval> | undefined
      try {
        GlobalBus.on("event", handler)
        await send({ type: "server.connected", properties: {} })
        heartbeat = setInterval(() => {
          void send({ type: "server.heartbeat", properties: {} })
        }, 10_000)

        await new Promise<void>((resolve) => {
          stream.onAbort(() => {
            resolve()
          })
        })
      } finally {
        if (heartbeat) clearInterval(heartbeat)
        GlobalBus.off("event", handler)
      }
    })
  })
}
