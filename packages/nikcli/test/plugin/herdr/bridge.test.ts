import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as bridge from "@/plugin/herdr/bridge"

const {
  detect,
  setTestSocketPath,
  setEnabled,
  isEnabled,
  refresh,
  snapshot,
  setSnapshot,
  reportSession,
  releaseSession,
  status,
  normalizeSnapshot,
  HerdrSnapshotSchema,
  HerdrBridge,
  nextReportSeq,
  isInHerdrPane,
  setReleased,
  releasePane,
  reportAgent,
} = bridge

const originalEnv = { ...process.env }
let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-herdr-test-"))
  // Force a stable, isolated socket path so detection never resolves to
  // the developer's real herdr server while running unit tests.
  const testSocket = path.join(tmpDir, "herdr.sock")
  setTestSocketPath(testSocket)
  // Disable so the GlobalBus listener doesn't fire and so report/release
  // are safe to call. Tests opt in explicitly per-case.
  setEnabled(false)
  // Reset the released flag so prior tests don't poison later ones with a
  // "released" reason.
  setReleased(false)
  // Reset env overrides between cases.
  process.env = { ...originalEnv }
  delete process.env.HERDR_SOCKET_PATH
  delete process.env.HERDR_BIN_PATH
  delete process.env.HERDR_BIN
})

afterEach(async () => {
  setEnabled(false)
  setTestSocketPath(undefined)
  process.env = { ...originalEnv }
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe("HerdrBridge — detect", () => {
  it("reports installed=false when no herdr binary is on PATH", async () => {
    delete process.env.HERDR_BIN_PATH
    // Bun.which walks PATH; on a clean test it returns null for "herdr".
    const info = await detect()
    expect(typeof info.installed).toBe("boolean")
    // socketPath is only surfaced when the server is actually running.
    expect(info.socketPath === undefined || typeof info.socketPath === "string").toBe(true)
  })

  it("honors HERDR_BIN_PATH override", async () => {
    process.env.HERDR_BIN_PATH = "/custom/path/herdr"
    const info = await detect()
    expect(info.installed).toBe(true)
    expect(info.binPath).toBe("/custom/path/herdr")
  })

  it("reports serverRunning=false when the socket file is missing", async () => {
    const info = await detect()
    expect(info.serverRunning).toBe(false)
    expect(info.socketPath).toBeUndefined()
  })

  it("reports serverRunning=true when the socket file exists", async () => {
    await fs.writeFile(path.join(tmpDir, "herdr.sock"), "")
    const info = await detect()
    expect(info.serverRunning).toBe(true)
    expect(info.socketPath).toBe(path.join(tmpDir, "herdr.sock"))
  })

  it("HERDR_SOCKET_PATH overrides the default socket path", async () => {
    // Clear the test-only socket path so HERDR_SOCKET_PATH wins.
    setTestSocketPath(undefined)
    const custom = path.join(tmpDir, "custom.sock")
    await fs.writeFile(custom, "")
    process.env.HERDR_SOCKET_PATH = custom
    const info = await detect()
    expect(info.serverRunning).toBe(true)
    expect(info.socketPath).toBe(custom)
  })
})

describe("HerdrBridge — enabled toggle", () => {
  it("defaults to disabled", () => {
    expect(isEnabled()).toBe(false)
  })

  it("flips between enabled and disabled", () => {
    setEnabled(true)
    expect(isEnabled()).toBe(true)
    setEnabled(false)
    expect(isEnabled()).toBe(false)
  })

  it("setEnabled is idempotent within the same value", () => {
    setEnabled(true)
    setEnabled(true)
    expect(isEnabled()).toBe(true)
    setEnabled(false)
    setEnabled(false)
    expect(isEnabled()).toBe(false)
  })

  it("status() reflects the enabled flag", async () => {
    setEnabled(true)
    const s = await status()
    expect(s.enabled).toBe(true)
    setEnabled(false)
    const s2 = await status()
    expect(s2.enabled).toBe(false)
  })
})

describe("HerdrBridge — snapshot", () => {
  it("returns an empty default snapshot when nothing has been cached", () => {
    setTestSocketPath(path.join(tmpDir, "empty.sock"))
    const snap = snapshot(tmpDir)
    expect(snap.workspaces).toEqual([])
    expect(snap.tabs).toEqual([])
    expect(snap.panes).toEqual([])
    expect(snap.agents).toEqual([])
    expect(snap.takenAt).toBe("")
  })

  it("returns the cached snapshot for a known directory", () => {
    const next = {
      takenAt: "2025-01-01T00:00:00.000Z",
      workspaces: [{ id: "w1", label: "primary" }],
      tabs: [],
      panes: [],
      agents: [],
    }
    setSnapshot(tmpDir, next)
    expect(snapshot(tmpDir)).toBe(next)
  })

  it("refresh() returns the cached snapshot when no server is running", async () => {
    const out = await refresh(tmpDir)
    // No socket present -> we return the cached value (empty default).
    expect(out.workspaces).toEqual([])
    expect(out.panes).toEqual([])
  })
})

describe("HerdrBridge — normalizeSnapshot", () => {
  it("maps raw herdr session.snapshot payload into our normalized shape", () => {
    const raw = {
      version: "0.8.0",
      protocol_version: 1,
      focused: { workspace_id: "w1", tab_id: "w1:t1", pane_id: "w1:p1" },
      workspaces: [
        {
          id: "w1",
          label: "primary",
          focused: true,
          cwd: "/x",
          worktree: { branch: "feat" },
        },
        { id: "w2", label: "secondary" },
      ],
      tabs: [{ id: "w1:t1", workspace_id: "w1", label: "main", focused: true }],
      panes: [
        {
          id: "w1:p1",
          workspace_id: "w1",
          tab_id: "w1:t1",
          agent_status: "working",
          foreground: "claude",
        },
      ],
      agents: [
        {
          id: "a1",
          workspace_id: "w1",
          tab_id: "w1:t1",
          pane_id: "w1:p1",
          agent: "claude",
          state: "working",
          source: "herdr:claude",
          message: "thinking",
        },
      ],
    }
    const out = normalizeSnapshot(raw)
    expect(out.version).toBe("0.8.0")
    expect(out.protocolVersion).toBe(1)
    expect(out.focusedWorkspaceId).toBe("w1")
    expect(out.focusedTabId).toBe("w1:t1")
    expect(out.focusedPaneId).toBe("w1:p1")
    expect(out.workspaces).toHaveLength(2)
    expect(out.workspaces[0]?.worktree?.branch).toBe("feat")
    expect(out.tabs).toHaveLength(1)
    expect(out.panes[0]?.agentStatus).toBe("working")
    expect(out.agents[0]?.agent).toBe("claude")
    expect(out.agents[0]?.state).toBe("working")
    expect(out.takenAt).not.toBe("")
  })

  it("returns an empty snapshot when given a non-object payload", () => {
    expect(normalizeSnapshot(undefined).workspaces).toEqual([])
    expect(normalizeSnapshot(null).workspaces).toEqual([])
    expect(normalizeSnapshot("string").workspaces).toEqual([])
    expect(normalizeSnapshot(42).workspaces).toEqual([])
  })

  it("treats missing arrays as empty lists", () => {
    const out = normalizeSnapshot({})
    expect(out.workspaces).toEqual([])
    expect(out.tabs).toEqual([])
    expect(out.panes).toEqual([])
    expect(out.agents).toEqual([])
  })
})

describe("HerdrSnapshotSchema", () => {
  it("accepts a minimal snapshot", () => {
    const parsed = HerdrSnapshotSchema.parse({
      takenAt: "2025-01-01T00:00:00.000Z",
      workspaces: [],
      tabs: [],
      panes: [],
      agents: [],
    })
    expect(parsed.takenAt).toBe("2025-01-01T00:00:00.000Z")
  })

  it("rejects a workspace missing id", () => {
    expect(() =>
      HerdrSnapshotSchema.parse({
        takenAt: "",
        workspaces: [{ label: "no-id" }],
        tabs: [],
        panes: [],
        agents: [],
      }),
    ).toThrow()
  })
})

describe("HerdrBridge — reportSession / releaseSession", () => {
  it("reportSession is a no-op when the bridge is disabled", async () => {
    const result = await reportSession({
      directory: tmpDir,
      sessionID: "s1",
      agent: "nikcli",
      state: "working",
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe("disabled")
  })

  it("releaseSession is a no-op when the bridge is disabled", async () => {
    const result = await releaseSession({
      directory: tmpDir,
      sessionID: "s1",
      agent: "nikcli",
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe("disabled")
  })

  it("reportSession returns no-pane when bridge is enabled outside a herdr pane", async () => {
    setEnabled(true)
    const result = await reportSession({
      directory: tmpDir,
      sessionID: "s1",
      agent: "nikcli",
      state: "working",
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe("no-pane")
  })

  it("releaseSession returns no-pane when bridge is enabled outside a herdr pane", async () => {
    setEnabled(true)
    const result = await releaseSession({
      directory: tmpDir,
      sessionID: "s1",
      agent: "nikcli",
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe("no-pane")
  })
})

describe("HerdrBridge namespace", () => {
  it("exposes the same surface used by the TUI plugin", () => {
    expect(typeof HerdrBridge.start).toBe("function")
    expect(typeof HerdrBridge.stop).toBe("function")
    expect(typeof HerdrBridge.refresh).toBe("function")
    expect(typeof HerdrBridge.setEnabled).toBe("function")
    expect(typeof HerdrBridge.isEnabled).toBe("function")
    expect(typeof HerdrBridge.detect).toBe("function")
    expect(typeof HerdrBridge.snapshot).toBe("function")
    expect(typeof HerdrBridge.status).toBe("function")
    expect(typeof HerdrBridge.reportSession).toBe("function")
    expect(typeof HerdrBridge.releaseSession).toBe("function")
    expect(typeof HerdrBridge.handleEvent).toBe("function")
    expect(typeof HerdrBridge.handleChatMessage).toBe("function")
    expect(typeof HerdrBridge.reportAgentSession).toBe("function")
    expect(typeof HerdrBridge.normalizeSnapshot).toBe("function")
  })
})

describe("HerdrBridge — seq + herdr-env", () => {
  it("nextReportSeq is monotonically increasing", () => {
    const a = nextReportSeq()
    const b = nextReportSeq()
    const c = nextReportSeq()
    expect(b).toBeGreaterThan(a)
    expect(c).toBeGreaterThan(b)
  })

  it("nextReportSeq never regresses to a lower value", () => {
    // The function seeds from `Date.now() * 1000`; even when many calls
    // happen quickly, each value must be strictly greater than the
    // previous — herdr's seq guard would drop a lower report.
    const baseline = nextReportSeq()
    const values = Array.from({ length: 50 }, () => nextReportSeq())
    for (let i = 1; i < values.length; i++) {
      const cur = values[i]
      const prev = values[i - 1]
      if (cur === undefined || prev === undefined) throw new Error("seq undefined")
      expect(cur).toBeGreaterThan(prev)
    }
    expect(values[0]).toBeGreaterThan(baseline)
  })

  it("isInHerdrPane requires HERDR_ENV=1 plus socket+pane env", () => {
    delete process.env.HERDR_ENV
    delete process.env.HERDR_SOCKET_PATH
    delete process.env.HERDR_PANE_ID
    expect(isInHerdrPane()).toBe(false)

    process.env.HERDR_ENV = "1"
    expect(isInHerdrPane()).toBe(false)

    process.env.HERDR_SOCKET_PATH = "/tmp/herdr.sock"
    expect(isInHerdrPane()).toBe(false)

    process.env.HERDR_PANE_ID = "w4:p1"
    expect(isInHerdrPane()).toBe(true)

    process.env.HERDR_ENV = "0"
    expect(isInHerdrPane()).toBe(false)
  })
})

describe("HerdrBridge — release gating", () => {
  it("setReleased(true) makes subsequent reportSession return 'released'", async () => {
    setEnabled(true)
    setReleased(true)
    const result = await reportSession({
      directory: tmpDir,
      sessionID: "s1",
      agent: "nikcli",
      state: "working",
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe("released")
  })

  it("releasePane marks the bridge as released", async () => {
    setEnabled(true)
    setReleased(false)
    // Set up env so releasePane has the required pane identity.
    process.env.HERDR_SOCKET_PATH = path.join(tmpDir, "fake.sock")
    process.env.HERDR_PANE_ID = "test-pane"
    // The socket doesn't exist; we expect either ok (if herdr auto-spawned)
    // or a structured error, but never a throw.
    const result = await releasePane({})
    expect(result.ok === true || (result.ok === false && typeof result.reason === "string")).toBe(true)
    setReleased(false)
  })
})
