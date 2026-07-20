/**
 * Daemon — runs a {@link SessionManager} behind a Unix-socket HTTP server so
 * background browser sessions outlive any single CLI invocation. This is what
 * makes browser-control "control it in the background" rather than "control
 * it for the lifetime of one process": terminal-control gets that property
 * from a compiled native driver process; here it's this daemon.
 *
 * The daemon self-terminates after `IDLE_SHUTDOWN_MS` with zero open sessions,
 * so a forgotten `start` doesn't leave a headless Chromium running forever.
 */
import { unlink } from "node:fs/promises"
import { SessionManager } from "./manager"
import { toJSONFrame } from "./render/json"

const IDLE_SHUTDOWN_MS = 10 * 60 * 1000 // 10 minutes with no sessions.
const IDLE_CHECK_MS = 30_000

interface RpcRequest {
  readonly method: string
  readonly params?: Record<string, unknown>
}

type RpcHandler = (manager: SessionManager, params: Record<string, unknown>) => Promise<unknown>

const handlers: Record<string, RpcHandler> = {
  async start(manager, p) {
    return manager.start({
      name: p.name as string | undefined,
      url: p.url as string | undefined,
      viewport: p.viewport as { width: number; height: number } | undefined,
      userAgent: p.userAgent as string | undefined,
      record: p.record as boolean | undefined,
    })
  },
  async list(manager) {
    return manager.list()
  },
  async info(manager, p) {
    return manager.info(p.name as string)
  },
  async goto(manager, p) {
    await manager.goto(p.name as string, p.url as string)
    return manager.info(p.name as string)
  },
  async send(manager, p) {
    await manager.send(p.name as string, p.input as string, p.mode as "text" | "keys" | undefined)
    return manager.info(p.name as string)
  },
  async click(manager, p) {
    await manager.click(p.name as string, p.selector as string)
    return manager.info(p.name as string)
  },
  async fill(manager, p) {
    await manager.fill(p.name as string, p.selector as string, p.value as string)
    return manager.info(p.name as string)
  },
  async hover(manager, p) {
    await manager.hover(p.name as string, p.selector as string)
    return manager.info(p.name as string)
  },
  async scroll(manager, p) {
    await manager.scroll(p.name as string, p.dx as number, p.dy as number)
    return manager.info(p.name as string)
  },
  async wait(manager, p) {
    const result = await manager.wait(p.name as string, p.condition as Parameters<SessionManager["wait"]>[1])
    return { satisfied: result.satisfied, reason: result.reason, frame: toJSONFrame(result.frame) }
  },
  async resize(manager, p) {
    return manager.resize(p.name as string, p.width as number, p.height as number)
  },
  async snapshot(manager, p) {
    const frame = await manager.snapshot(p.name as string)
    return toJSONFrame(frame)
  },
  async text(manager, p) {
    return manager.text(p.name as string)
  },
  async rawConsole(manager, p) {
    return manager.rawConsole(p.name as string, p.lines as number | undefined)
  },
  async stop(manager, p) {
    await manager.stop(p.name as string)
    return { stopped: true }
  },
  async remove(manager, p) {
    await manager.remove(p.name as string)
    return { removed: true }
  },
  async restart(manager, p) {
    return manager.restart(p.name as string)
  },
  async startRecording(manager, p) {
    await manager.startRecording(p.name as string, { sampleFps: p.sampleFps as number | undefined })
    return { recording: true }
  },
  async marker(manager, p) {
    return manager.marker(p.name as string, p.markerName as string)
  },
  async stopRecording(manager, p) {
    return manager.stopRecording(p.name as string)
  },
  async recordingData(manager, p) {
    return manager.recordingData(p.name as string)
  },
  async isRecording(manager, p) {
    return { recording: manager.isRecording(p.name as string) }
  },
  async videoPath(manager, p) {
    return { path: await manager.videoPath(p.name as string) }
  },
}

export async function startDaemon(socketPath: string): Promise<void> {
  // A daemon that died without running its shutdown handler (crash, kill -9,
  // machine restart) leaves its socket file behind; Bun.serve can't bind over
  // an existing path, which would otherwise wedge every future ensureDaemon
  // call for this workspace. Standard Unix-domain-socket-server hygiene: the
  // last writer to bind always unlinks first.
  await unlink(socketPath).catch(() => {})

  const manager = new SessionManager()
  let lastActivity = Date.now()
  let shuttingDown = false

  const idleTimer = setInterval(() => {
    if (manager.runningCount === 0 && Date.now() - lastActivity > IDLE_SHUTDOWN_MS) void shutdown()
  }, IDLE_CHECK_MS)
  idleTimer.unref()

  async function shutdown(): Promise<void> {
    if (shuttingDown) return
    shuttingDown = true
    clearInterval(idleTimer)
    await manager.closeAll().catch(() => {})
    await unlink(socketPath).catch(() => {})
    process.exit(0)
  }

  const server = Bun.serve({
    unix: socketPath,
    async fetch(req) {
      lastActivity = Date.now()
      const url = new URL(req.url)
      if (url.pathname === "/health") return new Response("ok")
      if (url.pathname === "/shutdown" && req.method === "POST") {
        void shutdown()
        return Response.json({ ok: true })
      }
      if (url.pathname !== "/rpc" || req.method !== "POST") {
        return new Response("not found", { status: 404 })
      }
      try {
        const body = (await req.json()) as RpcRequest
        const handler = handlers[body.method]
        if (!handler) return Response.json({ ok: false, error: `Unknown method: ${body.method}` }, { status: 400 })
        const result = await handler(manager, body.params ?? {})
        return Response.json({ ok: true, result })
      } catch (error) {
        return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 })
      }
    },
  })

  process.on("SIGTERM", () => void shutdown())
  process.on("SIGINT", () => void shutdown())
  process.on("exit", () => server.stop(true))
}

if (import.meta.main) {
  const socketArg = Bun.argv.indexOf("--socket")
  const socketPath = socketArg !== -1 ? Bun.argv[socketArg + 1] : undefined
  if (!socketPath) {
    process.stderr.write("browser-control daemon requires --socket PATH\n")
    process.exit(1)
  }
  startDaemon(socketPath).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  })
}
