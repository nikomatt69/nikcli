import { unlink } from "node:fs/promises"
import type { Surface, SurfaceEvent } from "@nikcli-ai/native-ui-protocol"
import { SessionManager } from "./manager"
import type { WaitCondition } from "./session"

export async function startDaemon(socket: string) {
  await unlink(socket).catch(() => undefined)
  const manager = new SessionManager()
  const handlers: Record<string, (p: Record<string, unknown>) => unknown | Promise<unknown>> = {
    start: (p) =>
      manager.start({
        name: p.name as string | undefined,
        url: p.url as string,
      }),
    list: () => manager.list(),
    info: (p) => manager.info(p.name as string),
    open: (p) => manager.open(p.name as string, p.surface as Surface),
    update: (p) => manager.update(p.name as string, p.surface as Surface),
    close: (p) => manager.close(p.name as string, p.surfaceID as string),
    dispatch: (p) => manager.dispatch(p.name as string, p.event as SurfaceEvent),
    snapshot: (p) => manager.snapshot(p.name as string),
    wait: (p) => manager.wait(p.name as string, (p.condition ?? {}) as WaitCondition),
    stop: (p) => manager.stop(p.name as string),
    remove: (p) => manager.remove(p.name as string),
    closeAll: () => manager.closeAll(),
  }
  let stopping = false
  const shutdown = async () => {
    if (stopping) return
    stopping = true
    manager.closeAll()
    server.stop(true)
    await unlink(socket).catch(() => undefined)
    process.exit(0)
  }
  const server = Bun.serve({
    unix: socket,
    async fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === "/health") return new Response("ok")
      if (url.pathname === "/shutdown" && req.method === "POST") {
        void shutdown()
        return Response.json({ ok: true })
      }
      if (url.pathname !== "/rpc" || req.method !== "POST") return new Response("not found", { status: 404 })
      try {
        const body = (await req.json()) as {
          method: string
          params?: Record<string, unknown>
        }
        const handler = handlers[body.method]
        if (!handler) return Response.json({ ok: false, error: `Unknown method: ${body.method}` }, { status: 400 })
        return Response.json({
          ok: true,
          result: await handler(body.params ?? {}),
        })
      } catch (error) {
        return Response.json(
          {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          },
          { status: 500 },
        )
      }
    },
  })
  process.on("SIGINT", () => void shutdown())
  process.on("SIGTERM", () => void shutdown())
}

if (import.meta.main) {
  const index = Bun.argv.indexOf("--socket")
  const socket = index >= 0 ? Bun.argv[index + 1] : undefined
  if (!socket) throw new Error("native-control daemon requires --socket PATH")
  await startDaemon(socket)
}
