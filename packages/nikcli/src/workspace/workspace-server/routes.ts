import { GlobalBus } from "../../bus/global"

export function shouldForwardWorkspaceEvent(eventDirectory: string | undefined, allowed: Array<string | undefined>) {
  const targets = allowed.filter((target): target is string => Boolean(target))
  if (!eventDirectory || targets.length === 0) return true
  return targets.includes(eventDirectory)
}

export function workspaceEventResponse(request: Request) {
  const url = new URL(request.url)
  const directory = url.searchParams.get("directory") ?? request.headers.get("x-nikcli-directory") ?? undefined
  const workspaceID = url.searchParams.get("workspace") ?? request.headers.get("x-nikcli-workspace") ?? undefined
  let close: (() => void) | undefined
  const abort = () => close?.()
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      close?.()
    },
    start(controller) {
      const encoder = new TextEncoder()
      let closed = false
      const send = (event: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch {
          close?.()
        }
      }
      const handler = (event: { directory?: string; payload: unknown }) => {
        if (shouldForwardWorkspaceEvent(event.directory, [directory, workspaceID])) send(event.payload)
      }
      GlobalBus.on("event", handler)
      send({ type: "server.connected", properties: {} })
      const heartbeat = setInterval(() => send({ type: "server.heartbeat", properties: {} }), 10_000)
      close = () => {
        if (closed) return
        closed = true
        clearInterval(heartbeat)
        GlobalBus.off("event", handler)
        request.signal.removeEventListener("abort", abort)
        try {
          controller.close()
        } catch {}
      }
      request.signal.addEventListener("abort", abort)
    },
  })
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      "x-content-type-options": "nosniff",
    },
  })
}
