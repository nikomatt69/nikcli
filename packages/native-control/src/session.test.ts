import { describe, expect, test } from "bun:test"
import type { Surface, SurfaceEvent } from "@nikcli-ai/native-ui-protocol"
import { NativeSession } from "./session"

// Minimal in-process stand-in for the nikcli /native-ui routes.
function serveNativeUI() {
  const surfaces = new Map<string, Surface>()
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>()
  const encoder = new TextEncoder()
  const broadcast = (event: SurfaceEvent) => {
    for (const client of [...clients]) {
      try {
        client.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      } catch {
        clients.delete(client)
      }
    }
  }
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === "/native-ui/surfaces" && req.method === "GET") return Response.json([...surfaces.values()])
      if (url.pathname === "/native-ui/surfaces" && req.method === "POST") {
        const surface = (await req.json()) as Surface
        surfaces.set(surface.id, surface)
        broadcast({ type: "surface-opened", surface })
        return Response.json(surface)
      }
      if (url.pathname.startsWith("/native-ui/surfaces/") && req.method === "DELETE") {
        const id = decodeURIComponent(url.pathname.slice("/native-ui/surfaces/".length))
        surfaces.delete(id)
        broadcast({ type: "surface-closed", surfaceId: id, reason: "system" })
        return new Response(null, { status: 204 })
      }
      if (url.pathname === "/native-ui/events" && req.method === "POST") {
        const event = (await req.json()) as SurfaceEvent
        broadcast(event)
        return Response.json(event)
      }
      if (url.pathname === "/native-ui/events") {
        let controller!: ReadableStreamDefaultController<Uint8Array>
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            controller = c
            clients.add(c)
          },
          cancel() {
            clients.delete(controller)
          },
        })
        return new Response(stream, { headers: { "content-type": "text/event-stream" } })
      }
      return new Response("not found", { status: 404 })
    },
  })
  return {
    url: `http://127.0.0.1:${server.port}`,
    broadcast,
    clientCount: () => clients.size,
    stop: () => server.stop(true),
  }
}

async function until(check: () => boolean, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error("condition not reached in time")
    await Bun.sleep(10)
  }
}

const dialog: Surface = {
  id: "review",
  kind: "dialog",
  title: "Review",
  controls: [],
  dismissible: true,
  modal: true,
  width: "medium",
  layout: "stack",
}

const activation: SurfaceEvent = {
  type: "control-activated",
  surfaceId: "review",
  controlId: "approve",
  action: { type: "invoke", action: "approve" },
}

describe("NativeSession", () => {
  test("tracks open surfaces across calls and stream events", async () => {
    const backend = serveNativeUI()
    const session = new NativeSession("tracking", backend.url)
    try {
      await until(() => backend.clientCount() === 1)
      await session.open(dialog)
      expect(session.info().surfaces).toBe(1)
      await session.close(dialog.id)
      expect(session.info().surfaces).toBe(0)

      backend.broadcast({ type: "surface-opened", surface: { ...dialog, id: "streamed" } })
      await until(() => session.info().surfaces === 1)
      backend.broadcast({ type: "surface-closed", surfaceId: "streamed", reason: "dismissed" })
      await until(() => session.info().surfaces === 0)
    } finally {
      session.stop()
      backend.stop()
    }
  })

  test("delivers each event to a single wait", async () => {
    const backend = serveNativeUI()
    const session = new NativeSession("waits", backend.url)
    try {
      await until(() => backend.clientCount() === 1)
      const pending = session.wait({ surfaceID: "review", event: "control-activated" })
      backend.broadcast(activation)
      await expect(pending).resolves.toMatchObject({ controlId: "approve" })
      await expect(session.wait({ surfaceID: "review", event: "control-activated", timeout: 100 })).rejects.toThrow(
        "Timed out",
      )
    } finally {
      session.stop()
      backend.stop()
    }
  })

  test("resolves waits from events that arrived first", async () => {
    const backend = serveNativeUI()
    const session = new NativeSession("buffered", backend.url)
    try {
      await until(() => backend.clientCount() === 1)
      backend.broadcast(activation)
      await until(() => session.info().events === 1)
      await expect(session.wait({ surfaceID: "review", timeout: 100 })).resolves.toMatchObject({
        controlId: "approve",
      })
    } finally {
      session.stop()
      backend.stop()
    }
  })

  test("aborts pending waits when the session stops", async () => {
    const backend = serveNativeUI()
    const session = new NativeSession("stopping", backend.url)
    try {
      const pending = session.wait({ surfaceID: "review" })
      session.stop()
      await expect(pending).rejects.toThrow("closed while waiting")
      expect(() => session.wait({})).toThrow("is closed")
    } finally {
      backend.stop()
    }
  })
})
