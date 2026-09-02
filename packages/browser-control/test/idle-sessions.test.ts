/**
 * A session nobody comes back to used to hold its browser for the uptime of the
 * machine: the daemon's idle shutdown waits for zero *running* sessions, so one
 * forgotten `start` pinned it (eleven chrome.exe processes on Windows) forever.
 */
import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { idleMinutes, startDaemon } from "../src/daemon"
import { SessionManager } from "../src/manager"
import { rpc, socketPathFor } from "../src/daemon-client"
import type { SessionInfo } from "../src/session"

const BLANK = "data:text/html,<title>idle</title>"

/** A machine with no usable browser skips, the way webview.test.ts does. */
async function startedSession(manager: SessionManager): Promise<SessionInfo | undefined> {
  return manager.start({ url: BLANK }).catch((error: Error) => {
    console.warn("browser unavailable, skipping:", error.message)
    return undefined
  })
}

describe("idleMinutes", () => {
  test("defaults to 30 minutes", () => {
    expect(idleMinutes(undefined)).toBe(30)
    expect(idleMinutes("")).toBe(30)
  })

  test("takes an explicit override, including 0 to disable reaping", () => {
    expect(idleMinutes("5")).toBe(5)
    expect(idleMinutes("0.05")).toBe(0.05)
    expect(idleMinutes("0")).toBe(0)
  })

  test("falls back to the default rather than disabling itself on a bad value", () => {
    expect(idleMinutes("nonsense")).toBe(30)
    expect(idleMinutes("-1")).toBe(30)
  })
})

describe("SessionManager.reapIdle", () => {
  test("keeps a session that was just used and stops one that was abandoned", async () => {
    const manager = new SessionManager()
    const info = await startedSession(manager)
    if (!info) return

    try {
      expect(await manager.reapIdle(60_000)).toEqual([])
      expect(manager.runningCount).toBe(1)

      await Bun.sleep(30)
      expect(await manager.reapIdle(10)).toEqual([info.name])
      expect(manager.runningCount).toBe(0)
      // Stopped, not forgotten: the name still resolves, as with an explicit stop.
      expect(manager.info(info.name).status).toBe("closed")
    } finally {
      await manager.closeAll().catch(() => {})
    }
  }, 60_000)

  test("driving a session keeps it alive", async () => {
    const manager = new SessionManager()
    const info = await startedSession(manager)
    if (!info) return

    try {
      await Bun.sleep(30)
      await manager.goto(info.name, BLANK)
      expect(await manager.reapIdle(10_000)).toEqual([])
      expect(manager.runningCount).toBe(1)
    } finally {
      await manager.closeAll().catch(() => {})
    }
  }, 60_000)

  test("watching a session does not keep it alive", async () => {
    const manager = new SessionManager()
    const info = await startedSession(manager)
    if (!info) return

    try {
      await Bun.sleep(30)
      // Status reads are how a client watches a session it is not using. If
      // these counted as use, anything polling on a timer — a live view, a
      // status bar — would pin a browser forever and the reaper would never
      // fire, which is the whole point of it.
      manager.info(info.name)
      manager.isRecording(info.name)
      manager.recordingData(info.name)
      manager.rawConsole(info.name)
      manager.list()
      expect(await manager.reapIdle(10)).toEqual([info.name])
    } finally {
      await manager.closeAll().catch(() => {})
    }
  }, 60_000)

  test("never reaps a session that is streaming a live view", async () => {
    const manager = new SessionManager()
    const info = await startedSession(manager)
    if (!info) return

    try {
      await manager.startScreencast(info.name, { maxFps: 2 })
      await Bun.sleep(30)
      expect(await manager.reapIdle(10)).toEqual([])
      expect(manager.runningCount).toBe(1)
      await manager.stopScreencast(info.name)
      // Once the stream stops there is nothing keeping it: it becomes reapable.
      // stopScreencast is itself an operation, so let the session go quiet again.
      await Bun.sleep(30)
      expect(await manager.reapIdle(10)).toEqual([info.name])
    } finally {
      await manager.closeAll().catch(() => {})
    }
  }, 60_000)

  test("stopping the live view itself, without stopScreencast, lets the session go", async () => {
    const manager = new SessionManager()
    const info = await startedSession(manager)
    if (!info) return

    try {
      const session = manager.get(info.name)!
      const live = await manager.startScreencast(info.name, { maxFps: 2 })
      expect(session.isBusy()).toBe(true)
      // The HTTP stream path calls Screencast.stop() on this object — not
      // manager.stopScreencast(name), which would also kill a replacement view.
      await live.stop()
      expect(session.isBusy()).toBe(false)
      const used = session.lastUsedAt
      await Bun.sleep(20)
      session.detachScreencast(live)
      expect(session.lastUsedAt).toBeGreaterThan(used)
      await Bun.sleep(30)
      expect(await manager.reapIdle(10)).toEqual([info.name])
    } finally {
      await manager.closeAll().catch(() => {})
    }
  }, 60_000)

  test("never reaps a session that is recording", async () => {
    const manager = new SessionManager()
    const info = await startedSession(manager)
    if (!info) return

    try {
      await manager.startRecording(info.name)
      await Bun.sleep(30)
      expect(await manager.reapIdle(10)).toEqual([])
      expect(manager.runningCount).toBe(1)
    } finally {
      await manager.closeAll().catch(() => {})
    }
  }, 60_000)

  test("disabled by a zero window", async () => {
    const manager = new SessionManager()
    const info = await startedSession(manager)
    if (!info) return

    try {
      await Bun.sleep(30)
      expect(await manager.reapIdle(0)).toEqual([])
      expect(manager.runningCount).toBe(1)
    } finally {
      await manager.closeAll().catch(() => {})
    }
  }, 60_000)
})

describe("SessionManager.closeAll", () => {
  test("leaves the process able to open another session", async () => {
    const manager = new SessionManager()
    const first = await startedSession(manager)
    if (!first) return
    await manager.closeAll()

    // Regression: closeAll used to SIGKILL the shared browser subprocess via
    // Bun.WebView.closeAll(), after which every later view failed to spawn for
    // the life of the process — so one `close-all` bricked a running daemon.
    const again = new SessionManager()
    try {
      const second = await again.start({ url: BLANK })
      expect(second.status).toBe("running")
    } finally {
      await again.closeAll().catch(() => {})
    }
  }, 60_000)
})

describe("daemon left behind by the CLI", () => {
  test("survives reaping a session after the client process has exited", async () => {
    // The daemon must be started the way the CLI starts it and then be left
    // alone: `ensureDaemon` gives it `stderr: "pipe"` and the CLI exits right
    // after, closing the read end. Anything the daemon writes to stderr from
    // then on lands on a broken pipe and kills it, taking its sessions along.
    // Spawning the daemon from a test that stays alive does not reproduce that,
    // because the pipe stays open — the client has to be gone.
    const workspace = await mkdtemp(join(tmpdir(), "browser-control-cli-"))
    // The socket is per workspace root, and the root is the nearest ancestor
    // holding a `.git`. Without one the CLI would walk out of the temp dir and
    // share whatever daemon the surrounding checkout already has.
    await mkdir(join(workspace, ".git"), { recursive: true })
    const cli = join(import.meta.dir, "..", "src", "cli.ts")
    const socket = await socketPathFor(workspace)

    const client = Bun.spawn([process.execPath, cli, "start", "--url", BLANK], {
      cwd: workspace,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NIKCLI_BROWSER_IDLE_MINUTES: "0.05" },
    })
    const [code, out] = await Promise.all([client.exited, new Response(client.stdout).text()])
    if (code !== 0) {
      console.warn("browser unavailable, skipping:", out.slice(0, 200))
      return
    }
    expect(out).toContain("running")

    try {
      const deadline = Date.now() + 40_000
      let sessions: SessionInfo[] | undefined
      while (Date.now() < deadline) {
        await Bun.sleep(500)
        // A dead daemon means no socket to answer at all, which is the failure
        // this test exists to catch — so a throw here must not be swallowed.
        sessions = await rpc<SessionInfo[]>(socket, "list")
        if (sessions.every((s) => s.status !== "running")) break
      }
      expect(sessions?.map((s) => s.status)).toEqual(["closed"])
    } finally {
      await fetch("http://localhost/shutdown", { method: "POST", unix: socket } as RequestInit).catch(() => {})
    }
  }, 120_000)
})

describe("daemon", () => {
  test("stops an abandoned session on its own, without being asked", async () => {
    const previous = process.env.NIKCLI_BROWSER_IDLE_MINUTES
    // 0.05 min = 3s, which also shortens the sweep interval to match.
    process.env.NIKCLI_BROWSER_IDLE_MINUTES = "0.05"
    const socket = join(tmpdir(), `browser-control-idle-${crypto.randomUUID()}.sock`)

    try {
      await startDaemon(socket, { exitProcess: false })
      const started = await rpc<SessionInfo>(socket, "start", { url: BLANK }).catch((error: Error) => {
        console.warn("browser unavailable, skipping:", error.message)
        return undefined
      })
      if (!started) return

      expect((await rpc<SessionInfo[]>(socket, "list")).some((s) => s.status === "running")).toBe(true)

      const deadline = Date.now() + 30_000
      let sessions: SessionInfo[] = []
      while (Date.now() < deadline) {
        await Bun.sleep(500)
        sessions = await rpc<SessionInfo[]>(socket, "list")
        if (!sessions.some((s) => s.status === "running")) break
      }
      expect(sessions.every((s) => s.status !== "running")).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.NIKCLI_BROWSER_IDLE_MINUTES
      else process.env.NIKCLI_BROWSER_IDLE_MINUTES = previous
      await fetch("http://localhost/shutdown", { method: "POST", unix: socket } as RequestInit).catch(() => {})
    }
  }, 90_000)
})
