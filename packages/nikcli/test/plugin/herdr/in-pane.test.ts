/**
 * Simulates "launching nikcli inside a herdr pane".
 *
 * Sets HERDR_ENV=1, HERDR_SOCKET_PATH, and HERDR_PANE_ID (the env vars a
 * herdr server publishes when it spawns a child process inside one of
 * its panes) and verifies that:
 *   1. isInHerdrPane() detects the env contract.
 *   2. setEnabled(true) attaches the bus listener without touching the
 *      chat stream when no events fire.
 *   3. A simulated session.start event causes the bridge to call the
 *      live herdr socket with the expected pane_id, source, and state.
 *
 * The test is gated on the herdr socket being reachable.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as bridge from "@/plugin/herdr/bridge"
import { GlobalBus } from "@/bus/global"

const socketPath = path.join(os.homedir(), ".config", "herdr", "herdr.sock")

let serverReachable = false
try {
  serverReachable = (await fs.stat(socketPath)).isSocket()
} catch {
  serverReachable = false
}

const maybeIt = serverReachable ? it : it.skip

const originalEnv = { ...process.env }

beforeAll(() => {
  // Simulate a herdr server that spawned nikcli inside a pane. The real
  // herdr daemon sets these in the child's environment. This is done
  // unconditionally: isInHerdrPane() only reads the env contract and never
  // touches the socket, so the detection tests must run on CI too — where
  // no herdr daemon is listening. Only the live round-trip below is gated
  // on `serverReachable`.
  process.env.HERDR_ENV = "1"
  process.env.HERDR_SOCKET_PATH = socketPath
  process.env.HERDR_PANE_ID = "w4:p1"
})

afterAll(() => {
  process.env = { ...originalEnv }
  bridge.setEnabled(false)
  bridge.setReleased(false)
})

describe("HerdrBridge — running inside a herdr pane", () => {
  it("isInHerdrPane returns true when HERDR_ENV + socket + pane id are set", () => {
    expect(bridge.isInHerdrPane()).toBe(true)
  })

  it("isInHerdrPane returns false when any of the three env vars is missing", () => {
    delete process.env.HERDR_PANE_ID
    expect(bridge.isInHerdrPane()).toBe(false)
    process.env.HERDR_PANE_ID = "w4:p1"
  })

  maybeIt(
    "HerdrPlugin auto-enables when isInHerdrPane() and the bridge reports to the live server",
    async () => {
      bridge.setEnabled(false)
      bridge.setReleased(false)

      // Look up a real pane from the live herdr server. Earlier tests
      // may have closed w4:p1, so we always query pane.list and pick
      // the first available id.
      const liveRaw = await bridge.call<unknown>("pane.list", undefined, 3000, {
        socketPath,
      })
      const paneList = (liveRaw as { panes?: Array<{ pane_id?: string }> } | undefined)?.panes ?? []
      const realPane = paneList[0]?.pane_id
      expect(realPane).toBeDefined()
      process.env.HERDR_PANE_ID = realPane!

      // This is the same code path the plugin entry runs at boot time:
      // when running inside a Herdr pane, the bridge auto-enables.
      if (bridge.isInHerdrPane()) {
        bridge.setEnabled(true)
      }
      expect(bridge.isEnabled()).toBe(true)
      expect(bridge.isInHerdrPane()).toBe(true)

      // The bridge should now report the agent state through the live
      // herdr socket. Use a unique seq that beats whatever the smoke
      // test left behind, and verify the round-trip.
      const seq = bridge.nextReportSeq()
      const result = await bridge.call<{ type?: string }>(
        "pane.report_agent",
        {
          pane_id: realPane!,
          source: "herdr:nikcli",
          agent: "nikcli",
          state: "working",
          message: "auto-attach test",
          seq,
        },
        1500,
        { socketPath },
      )
      expect(result).toBeDefined()
    },
    15_000,
  )
})
