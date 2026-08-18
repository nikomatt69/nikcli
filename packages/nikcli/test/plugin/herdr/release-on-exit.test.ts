/**
 * Shutdown contract for the herdr integration.
 *
 * Herdr only clears agents it recognizes by process. nikcli is reported,
 * not detected, so quitting has to hand the pane back explicitly or the
 * agent panel keeps a zombie row until the pane's shell exits.
 */
import { afterAll, afterEach, describe, expect, it } from "bun:test"
import * as bridge from "@nikcli-ai/util/herdr-bridge"

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
  bridge.setReleased(false)
})

afterAll(() => {
  // installExitRelease() leaves a real listener behind. Mark the bridge
  // released so it cannot hand back the pane of whoever ran the suite.
  bridge.setReleased(true)
})

describe("herdr shutdown", () => {
  it("registers exactly one exit release, however many times it is installed", () => {
    const before = process.listenerCount("exit")
    bridge.installExitRelease()
    bridge.installExitRelease()
    expect(process.listenerCount("exit")).toBe(before + 1)
  })

  it("hands the pane back under the source herdr granted authority to", () => {
    expect(bridge.releaseAgentArgv("w1:p1", 42)).toEqual([
      "pane",
      "release-agent",
      "w1:p1",
      "--source",
      "herdr:nikcli",
      "--agent",
      "nikcli",
      "--seq",
      "42",
    ])
  })

  it("does nothing when there is no pane to hand back", () => {
    delete process.env.HERDR_PANE_ID
    expect(() => bridge.releasePaneSync()).not.toThrow()
  })
})
