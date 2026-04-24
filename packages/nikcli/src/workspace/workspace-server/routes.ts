import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { GlobalBus } from "../../bus/global"

export function shouldForwardWorkspaceEvent(eventDirectory: string | undefined, allowed: Array<string | undefined>) {
  const targets = allowed.filter((target): target is string => Boolean(target))
  if (!eventDirectory || targets.length === 0) return true
  return targets.includes(eventDirectory)
}

export function WorkspaceServerRoutes() {
  return new Hono().get("/event", async (c) => {
    c.header("X-Accel-Buffering", "no")
    c.header("X-Content-Type-Options", "nosniff")
    const directory = c.req.query("directory") || c.req.header("x-nikcli-directory")
    const workspaceID = c.req.query("workspace") || c.req.header("x-nikcli-workspace")
    return streamSSE(c, async (stream) => {
      const send = async (event: unknown) => {
        await stream.writeSSE({
          data: JSON.stringify(event),
        })
      }
      const handler = async (event: { directory?: string; payload: unknown }) => {
        if (!shouldForwardWorkspaceEvent(event.directory, [directory, workspaceID])) return
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
