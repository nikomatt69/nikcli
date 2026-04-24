import { describe, expect, it } from "bun:test"

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

describe("WorkspaceDB", () => {
  describe("appendEvent", () => {
    it("applies the default event limit when eventLimit is not set", async () => {
      const { WorkspaceDB } = await import("../../src/workspace/db")
      const events = Array.from({ length: WorkspaceDB.DEFAULT_EVENT_LIMIT + 5 }, (_, i) => ({ i }))

      const limited = WorkspaceDB.applyEventLimit(events, { i: "next" })

      expect(limited).toHaveLength(WorkspaceDB.DEFAULT_EVENT_LIMIT)
      expect(limited[0]).toEqual({ i: 6 })
      expect(limited.at(-1)).toEqual({ i: "next" })
    })

    it("applies a persisted custom event limit", async () => {
      const { WorkspaceDB } = await import("../../src/workspace/db")

      const limited = WorkspaceDB.applyEventLimit([{ i: 1 }, { i: 2 }], { i: 3 }, 2)

      expect(limited).toEqual([{ i: 2 }, { i: 3 }])
    })
  })
})
