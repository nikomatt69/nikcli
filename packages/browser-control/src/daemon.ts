/**
 * Daemon â€” runs a {@link SessionManager} behind a Unix-socket HTTP server so
 * background browser sessions outlive any single CLI invocation. This is what
 * makes browser-control "control it in the background" rather than "control
 * it for the lifetime of one process": terminal-control gets that property
 * from a compiled native driver process; here it's this daemon.
 *
 * Nothing here runs forever on its own account. A session nobody has touched
 * for `SESSION_IDLE_MS` is stopped, and once no session is running the daemon
 * itself exits `IDLE_SHUTDOWN_MS` later â€” so a forgotten `start` does not leave
 * a headless browser (eleven OS processes on Windows) alive for the uptime of
 * the machine.
 */
import { mkdir, rm, unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SessionManager } from "./manager"
import { toJSONFrame } from "./render/json"
import type { ScreencastFrame } from "./screencast"

const IDLE_SHUTDOWN_MS = 10 * 60 * 1000 // 10 minutes with no sessions.
const IDLE_CHECK_MS = 30_000

/**
 * How long a session may sit untouched before it is stopped.
 *
 * Generous on purpose: an agent that opens a page, goes away to think, and
 * comes back must find its session, so this is measured in "gave up on it"
 * time rather than "paused" time. A session streaming a live view or recording
 * is never reaped â€” see {@link SessionManager.reapIdle}.
 *
 * `NIKCLI_BROWSER_IDLE_MINUTES` overrides it; `0` disables reaping, restoring
 * the old behavior for anyone who wants a session to outlive their attention.
 */
const ENV_IDLE_MINUTES = "NIKCLI_BROWSER_IDLE_MINUTES"
const DEFAULT_IDLE_MINUTES = 30

export function idleMinutes(raw = process.env[ENV_IDLE_MINUTES]): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_IDLE_MINUTES
  const parsed = Number(raw)
  // A malformed value must not silently disable the reaper â€” that is the leak
  // this exists to prevent.
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_IDLE_MINUTES
  return parsed
}

/**
 * How many temp files a `file`-mode screencast rotates through. Kitty deletes
 * a `t=t` file once it has read it, so in the normal case at most one exists;
 * the ring bounds the damage when a terminal doesn't, and gives the terminal a
 * few frames of slack before a slot is overwritten under it.
 */
const FRAME_FILE_SLOTS = 4

/**
 * A screencast is silent whenever the page is static â€” nothing repainted, so
 * there is nothing to send. Perfectly correct, and indistinguishable from a
 * wedged stream to anyone downstream. A periodic ping keeps the connection
 * warm and gives the client a liveness signal it can act on.
 */
const SCREENCAST_PING_MS = 15_000

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
  async back(manager, p) {
    const moved = await manager.back(p.name as string)
    return { ...manager.info(p.name as string), moved }
  },
  async forward(manager, p) {
    const moved = await manager.forward(p.name as string)
    return { ...manager.info(p.name as string), moved }
  },
  async reload(manager, p) {
    await manager.reload(p.name as string)
    return manager.info(p.name as string)
  },
  async click(manager, p) {
    await manager.click(p.name as string, p.selector as string)
    return manager.info(p.name as string)
  },
  async pointer(manager, p) {
    await manager.pointer(p.name as string, p.input as Parameters<SessionManager["pointer"]>[1])
    return { ok: true }
  },
  async key(manager, p) {
    await manager.key(p.name as string, p.input as Parameters<SessionManager["key"]>[1])
    return { ok: true }
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

/**
 * How a frame's pixels reach the client.
 *
 * `file` writes the PNG to a temp file and sends only its path â€” the terminal
 * reads that same file itself (Kitty `t=t`), so the pixels never cross this
 * socket *or* the PTY. That is the whole point of the mode, and it only works
 * because the daemon, the client and the terminal share a filesystem.
 *
 * `inline` base64-encodes the PNG into the NDJSON line. Correct everywhere,
 * roughly 4/3 the bytes plus an encode per frame.
 */
export type FrameMode = "file" | "inline"

interface FrameFiles {
  readonly dir: string
  write(seq: number, png: Uint8Array): Promise<string>
  dispose(): Promise<void>
}

async function createFrameFiles(): Promise<FrameFiles> {
  const dir = join(tmpdir(), `nikcli-screencast-${Bun.randomUUIDv7()}`)
  await mkdir(dir, { recursive: true })
  return {
    dir,
    async write(seq, png) {
      const path = join(dir, `frame-${seq % FRAME_FILE_SLOTS}.png`)
      await Bun.write(path, png)
      return path
    },
    async dispose() {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    },
  }
}

function frameLine(frame: ScreencastFrame, payload: { path: string } | { pngBase64: string }) {
  return {
    type: "frame" as const,
    seq: frame.seq,
    width: frame.width,
    height: frame.height,
    deviceWidth: frame.deviceWidth,
    deviceHeight: frame.deviceHeight,
    scrollOffsetX: frame.scrollOffsetX,
    scrollOffsetY: frame.scrollOffsetY,
    pageScaleFactor: frame.pageScaleFactor,
    timestamp: frame.timestamp,
    ...payload,
  }
}

function positiveNumber(value: string | null): number | undefined {
  if (value === null) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

/**
 * `GET /screencast?name=&mode=&maxWidth=&maxHeight=&fps=&everyNthFrame=`
 *
 * One live view per request: the screencast starts when the request opens and
 * stops when it closes, so a client that goes away never leaves the WebView
 * capturing into the void.
 */
async function streamScreencast(manager: SessionManager, url: URL, signal: AbortSignal): Promise<Response> {
  const name = url.searchParams.get("name")
  if (!name) return Response.json({ ok: false, error: "screencast requires ?name=" }, { status: 400 })
  const mode: FrameMode = url.searchParams.get("mode") === "inline" ? "inline" : "file"

  let screencast: Awaited<ReturnType<SessionManager["startScreencast"]>>
  try {
    screencast = await manager.startScreencast(name, {
      maxWidth: positiveNumber(url.searchParams.get("maxWidth")),
      maxHeight: positiveNumber(url.searchParams.get("maxHeight")),
      maxFps: positiveNumber(url.searchParams.get("fps")),
      everyNthFrame: positiveNumber(url.searchParams.get("everyNthFrame")),
    })
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }

  const files = mode === "file" ? await createFrameFiles() : null
  const encoder = new TextEncoder()
  let closed = false

  const finish = async () => {
    if (closed) return
    closed = true
    await screencast.stop().catch(() => {})
    await files?.dispose()
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const onAbort = () => void finish()
      signal.addEventListener("abort", onAbort, { once: true })

      let lastWrite = Date.now()
      const write = (line: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`))
        lastWrite = Date.now()
      }
      const ping = setInterval(() => {
        if (closed || signal.aborted) return
        if (Date.now() - lastWrite < SCREENCAST_PING_MS) return
        try {
          write({ type: "ping" })
        } catch {}
      }, SCREENCAST_PING_MS)
      ping.unref()

      void (async () => {
        try {
          for await (const frame of screencast.frames()) {
            if (signal.aborted || closed) break
            const payload = files
              ? { path: await files.write(frame.seq, frame.png) }
              : { pngBase64: frame.png.toBase64() }
            write(frameLine(frame, payload))
          }
        } catch (error) {
          if (!signal.aborted && !closed) {
            const message = error instanceof Error ? error.message : String(error)
            controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", error: message })}\n`))
          }
        } finally {
          clearInterval(ping)
          signal.removeEventListener("abort", onAbort)
          await finish()
          try {
            controller.close()
          } catch {}
        }
      })()
    },
    cancel() {
      void finish()
    },
  })

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-screencast-mode": mode,
    },
  })
}

export type StartDaemonOptions = {
  /**
   * When true (default for a dedicated daemon process), idle/shutdown ends the
   * OS process. When false (in-process host inside the compiled nikcli binary),
   * only the Unix server and sessions are torn down â€” the host keeps running.
   */
  readonly exitProcess?: boolean
}

export async function startDaemon(socketPath: string, options: StartDaemonOptions = {}): Promise<void> {
  // A daemon that died without running its shutdown handler (crash, kill -9,
  // machine restart) leaves its socket file behind; Bun.serve can't bind over
  // an existing path, which would otherwise wedge every future ensureDaemon
  // call for this workspace. Standard Unix-domain-socket-server hygiene: the
  // last writer to bind always unlinks first.
  await unlink(socketPath).catch(() => {})

  const exitProcess = options.exitProcess !== false
  const manager = new SessionManager()
  let lastActivity = Date.now()
  let shuttingDown = false

  // Sweeping less often than the idle window would let a session outlive it by
  // most of a check interval; with the default window the cap is what matters.
  const sweepMs = Math.max(1_000, Math.min(IDLE_CHECK_MS, idleMinutes() * 60 * 1000 || IDLE_CHECK_MS))
  const idleTimer = setInterval(() => {
    void sweep()
  }, sweepMs)
  idleTimer.unref()

  /**
   * Reap abandoned sessions first, then decide whether the daemon itself has
   * anything left to do. The order matters: the shutdown check below waits for
   * zero running sessions, so without the reap a single forgotten session keeps
   * both the daemon and its browser alive for as long as the machine is up.
   */
  async function sweep(): Promise<void> {
    if (shuttingDown) return
    // Silent on purpose. `ensureDaemon` spawns this process with `stderr: "pipe"`
    // and stops reading once the client is up, so writing here after the client
    // has gone kills the daemon on a broken pipe â€” taking the sessions it was
    // hosting with it. A reaped session already reports itself as "closed".
    await manager.reapIdle(idleMinutes() * 60 * 1000).catch(() => {})
    if (manager.runningCount === 0 && Date.now() - lastActivity > IDLE_SHUTDOWN_MS) void shutdown()
  }

  async function shutdown(): Promise<void> {
    if (shuttingDown) return
    shuttingDown = true
    clearInterval(idleTimer)
    await manager.closeAll().catch(() => {})
    try {
      server.stop(true)
    } catch {}
    await unlink(socketPath).catch(() => {})
    if (exitProcess) process.exit(0)
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
      if (url.pathname === "/screencast" && req.method === "GET") {
        return streamScreencast(manager, url, req.signal)
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
        return Response.json(
          { ok: false, error: error instanceof Error ? error.message : String(error) },
          { status: 500 },
        )
      }
    },
  })

  if (exitProcess) {
    process.on("SIGTERM", () => void shutdown())
    process.on("SIGINT", () => void shutdown())
  }
  process.on("exit", () => {
    try {
      server.stop(true)
    } catch {}
  })
}

if (import.meta.main) {
  const socketArg = Bun.argv.indexOf("--socket")
  const socketPath = socketArg !== -1 ? Bun.argv[socketArg + 1] : undefined
  if (!socketPath) {
    process.stderr.write("browser-control daemon requires --socket PATH\n")
    process.exit(1)
  }
  startDaemon(socketPath, { exitProcess: true }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  })
}
