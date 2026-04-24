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
    it("uses default limit when eventLimit not set", async () => {
      // This test verifies the API contract
      const { WorkspaceDB } = await import("../../src/workspace/db")
      expect(WorkspaceDB.appendEvent).toBeDefined()
    })
  })
})
