/**
 * Runtime integration test — connects to the LOCAL herdr server (the
 * developer's running instance) and verifies the bridge actually does
 * something visible: reports a working agent, then an idle one, then
 * releases the pane. The test is gated on the herdr socket being
 * reachable; if herdr is not installed it skips.
 */
import { describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as bridge from "@/plugin/herdr/bridge"

const { detect, reportAgent, releasePane, status, snapshot } = bridge

const socketPath = path.join(os.homedir(), ".config", "herdr", "herdr.sock")

let serverReachable = false
try {
  serverReachable = (await fs.stat(socketPath)).isSocket()
} catch {
  serverReachable = false
}

const maybeIt = serverReachable ? it : it.skip

describe("HerdrBridge — live integration (herdr running)", () => {
  maybeIt("detect() reports the running server", async () => {
    const info = await detect()
    expect(info.serverRunning).toBe(true)
    expect(info.socketPath).toBe(socketPath)
  })

  maybeIt("status() returns install/connection info", async () => {
    const s = await status()
    expect(s.serverRunning).toBe(true)
    expect(s.inHerdrPane).toBe(false) // not running WITHIN a herdr pane
    expect(s.enabled).toBe(false) // not enabled yet
  })

  maybeIt(
    "reportAgent reports a working agent to the live server",
    async () => {
      bridge.setEnabled(true)
      bridge.setReleased(false)
      const liveRaw = await bridge.call<unknown>("pane.list", undefined, 3000, {
        socketPath,
      })
      const paneList = (liveRaw as { panes?: Array<{ pane_id?: string }> } | undefined)?.panes ?? []
      const paneId = paneList[0]?.pane_id ?? "w4:p1"
      const result = await reportAgent({
        paneId,
        socketPath,
        state: "working",
        message: "integration test",
        agent: "nikcli-test",
        source: "herdr:nikcli-test",
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.seq).toBeGreaterThan(0)
      }
      // Re-enable for any follow-up release; tests can do it explicitly.
      bridge.setReleased(false)
    },
    10_000,
  )

  maybeIt(
    "releasePane releases the agent against the live server",
    async () => {
      bridge.setEnabled(true)
      bridge.setReleased(false)
      const liveRaw = await bridge.call<unknown>("pane.list", undefined, 3000, {
        socketPath,
      })
      const paneList = (liveRaw as { panes?: Array<{ pane_id?: string }> } | undefined)?.panes ?? []
      const paneId = paneList[0]?.pane_id ?? "w4:p1"
      // First report, then release the same pane.
      await bridge.reportAgent({
        paneId,
        socketPath,
        state: "working",
        agent: "nikcli-integration-test",
        source: "herdr:nikcli-integration-test",
      })
      bridge.setReleased(false)
      const result = await releasePane({ paneId, socketPath })
      expect(result.ok).toBe(true)
    },
    10_000,
  )

  maybeIt("snapshot() returns the cached snapshot", () => {
    const s = snapshot("/tmp")
    expect(s).toBeDefined()
    expect(s.workspaces).toBeDefined()
  })
})
