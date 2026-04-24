import { describe, expect, it } from "bun:test"
import { shouldForwardWorkspaceEvent } from "../../src/workspace/workspace-server/routes"

describe("WorkspaceServerRoutes", () => {
  describe("shouldForwardWorkspaceEvent", () => {
    it("forwards unscoped events", () => {
      expect(shouldForwardWorkspaceEvent(undefined, ["/project"])).toBe(true)
    })

    it("forwards scoped events that match the directory", () => {
      expect(shouldForwardWorkspaceEvent("/project", ["/project", undefined])).toBe(true)
    })

    it("forwards scoped events that match the workspace id", () => {
      expect(shouldForwardWorkspaceEvent("wrk_123", ["/project", "wrk_123"])).toBe(true)
    })

    it("drops scoped events for other workspaces", () => {
      expect(shouldForwardWorkspaceEvent("/other", ["/project", "wrk_123"])).toBe(false)
    })
  })
})
