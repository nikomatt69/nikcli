/**
 * Wire-contract test for the herdr integration.
 *
 * Stands up a fake herdr server on a unix socket, points the bridge at it
 * with the same three env vars a real herdr pane publishes, and asserts the
 * exact JSON-line requests nikcli emits. The expectations mirror herdr's own
 * plugin-based integrations (`herdr integration install opencode`), which is
 * the contract herdr's sidebar, attention queue, and session-resume rely on.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test"
import { createServer, type Server } from "node:net"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as bridge from "@/plugin/herdr/bridge"

type Received = { method: string; params: Record<string, any> }

let server: Server
let socketPath: string
let tmpDir: string
let received: Received[] = []

const originalEnv = { ...process.env }

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-herdr-wire-"))
  socketPath = path.join(tmpDir, "herdr.sock")
  server = createServer((socket) => {
    let buffer = ""
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8")
      let idx = buffer.indexOf("\n")
      while (idx >= 0) {
        const line = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 1)
        if (line) {
          const req = JSON.parse(line)
          received.push({ method: req.method, params: req.params ?? {} })
          socket.write(JSON.stringify({ id: req.id, result: { ok: true } }) + "\n")
        }
        idx = buffer.indexOf("\n")
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(socketPath, resolve))

  process.env.HERDR_ENV = "1"
  process.env.HERDR_SOCKET_PATH = socketPath
  process.env.HERDR_PANE_ID = "w1:p1"
  bridge.setTestSocketPath(socketPath)
  bridge.setReleased(false)
  bridge.setEnabled(true)
})

afterAll(async () => {
  bridge.stop()
  bridge.setTestSocketPath(undefined)
  process.env = { ...originalEnv }
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await fs.rm(tmpDir, { recursive: true, force: true })
})

afterEach(() => {
  received = []
})

describe("herdr wire contract — pane.report_agent", () => {
  it("reports under the canonical herdr:nikcli source with a session ref", async () => {
    await bridge.handleEvent({
      type: "session.status",
      properties: { sessionID: "ses_root", status: { type: "busy" } },
    })
    expect(received).toHaveLength(1)
    expect(received[0]!.method).toBe("pane.report_agent")
    expect(received[0]!.params).toMatchObject({
      pane_id: "w1:p1",
      source: "herdr:nikcli",
      agent: "nikcli",
      state: "working",
      agent_session_id: "ses_root",
    })
    expect(typeof received[0]!.params.seq).toBe("number")
  })

  it("maps idle status to idle and blockers to blocked", async () => {
    await bridge.handleEvent({
      type: "session.status",
      properties: { sessionID: "ses_root", status: { type: "idle" } },
    })
    await bridge.handleEvent({
      type: "permission.asked",
      properties: { sessionID: "ses_root" },
    })
    await bridge.handleEvent({
      type: "question.asked",
      properties: { sessionID: "ses_root" },
    })
    expect(received.map((r) => r.params.state)).toEqual(["idle", "blocked", "blocked"])
  })

  it("never sends `done` — herdr derives it and rejects it as a report", async () => {
    await bridge.reportAgent({ state: "done", sessionID: "ses_root" })
    expect(received[0]!.params.state).toBe("idle")
  })

  it("chat.message marks the pane working before the first status event", async () => {
    await bridge.handleChatMessage("ses_root")
    expect(received[0]!.params).toMatchObject({
      state: "working",
      agent_session_id: "ses_root",
    })
  })

  it("issues strictly increasing seq values so herdr never drops a report", async () => {
    await bridge.handleChatMessage("ses_root")
    await bridge.handleEvent({
      type: "session.idle",
      properties: { sessionID: "ses_root" },
    })
    const seqs = received.map((r) => r.params.seq as number)
    expect(seqs).toHaveLength(2)
    expect(seqs[1]!).toBeGreaterThan(seqs[0]!)
  })
})

describe("herdr wire contract — pane.report_agent_session", () => {
  it("publishes a new conversation ref on a root session.created", async () => {
    await bridge.handleEvent({
      type: "session.created",
      properties: { info: { id: "ses_new" } },
    })
    expect(received[0]!.method).toBe("pane.report_agent_session")
    expect(received[0]!.params).toMatchObject({
      agent_session_id: "ses_new",
      session_start_source: "new",
    })
  })

  it("re-publishes on session.updated only when the session ref changed", async () => {
    await bridge.handleEvent({
      type: "session.created",
      properties: { info: { id: "ses_a" } },
    })
    received = []
    await bridge.handleEvent({
      type: "session.updated",
      properties: { info: { id: "ses_a" } },
    })
    expect(received).toHaveLength(0)
    await bridge.handleEvent({
      type: "session.updated",
      properties: { info: { id: "ses_b" } },
    })
    expect(received[0]!.params.agent_session_id).toBe("ses_b")
  })
})

describe("herdr wire contract — subagent sessions", () => {
  it("blocks the pane for a child permission without stealing the session ref", async () => {
    await bridge.handleEvent({
      type: "session.created",
      properties: { info: { id: "ses_parent" } },
    })
    // A child session announces itself with a parentID.
    await bridge.handleEvent({
      type: "session.created",
      properties: { info: { id: "ses_child", parentID: "ses_parent" } },
    })
    received = []

    await bridge.handleEvent({
      type: "permission.asked",
      properties: { sessionID: "ses_child" },
    })
    expect(received).toHaveLength(1)
    expect(received[0]!.params.state).toBe("blocked")
    expect(received[0]!.params.agent_session_id).toBeUndefined()
  })

  it("ignores child lifecycle events that would otherwise idle the pane", async () => {
    await bridge.handleEvent({
      type: "session.idle",
      properties: { sessionID: "ses_child" },
    })
    expect(received).toHaveLength(0)
  })
})

describe("herdr wire contract — release", () => {
  it("releases the pane under the same source herdr granted authority to", async () => {
    const result = await bridge.releasePane()
    expect(result.ok).toBe(true)
    expect(received[0]!.method).toBe("pane.release_agent")
    expect(received[0]!.params).toMatchObject({
      pane_id: "w1:p1",
      source: "herdr:nikcli",
      agent: "nikcli",
    })
    bridge.setReleased(false)
  })
})
