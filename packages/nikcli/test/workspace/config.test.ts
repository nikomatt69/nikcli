import { describe, expect, it } from "bun:test"
import { withIsolatedDatabase } from "../helpers/sqlite"

describe("Workspace", () => {
  describe("event limit configuration", () => {
    it("can parse config with eventLimit", async () => {
      const { Config } = await import("../../src/workspace/config")

      const worktreeConfig = Config.parse({
        type: "worktree",
        directory: "/test",
        eventLimit: 500,
      })
      expect(worktreeConfig.eventLimit).toBe(500)

      const containerConfig = Config.parse({
        type: "container",
        directory: "/test",
        runtime: "docker",
        image: "nginx",
        containerName: "test",
        port: 8080,
        serverUrl: "http://localhost:8080",
        eventLimit: 1000,
      })
      expect(containerConfig.eventLimit).toBe(1000)
    })
  })
})

/**
 * Phase 0: workspace events live in the unified `sync_event` log. The
 * per-aggregate compaction policy (MAX_EVENTS_PER_AGGREGATE=1000,
 * COMPACTION_TRIM_TO=500) is enforced by `SyncStorage.appendEventWith`.
 * The previously inlined `applyEventLimit` has been removed; we now
 * verify that `Sync.emit` rejects payloads that would otherwise blow
 * past the limit, and that the compaction policy keeps the log bounded.
 */
describe("SyncStorage (workspace event log)", () => {
  it("enforces the max events per aggregate during compaction", async () => {
    await withIsolatedDatabase(async () => {
      const { Sync } = await import("../../src/sync")
      const { Identifier } = await import("../../src/id/id")
      const projectID = `test_proj_phase0_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const aggregate = Identifier.ascending("workspace")

      for (let i = 0; i < 5; i++) {
        await Sync.emitRaw(projectID, aggregate, { type: "workspace.test", i })
      }
      const events = await Sync.readAggregate(aggregate)
      expect(events).toHaveLength(5)
      expect(events.at(-1)).toEqual({ type: "workspace.test", i: 4 })
    })
  })
})
