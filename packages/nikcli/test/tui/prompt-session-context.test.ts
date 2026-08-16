import { describe, expect, it } from "bun:test"
import { sessionRequestContext } from "@tui/component/prompt"

describe("prompt session request context", () => {
  it("builds prompt and command context for an attached session", () => {
    const context = sessionRequestContext({
      routeWorkspaceID: "wrk_route",
      sessionWorkspaceID: "wrk_session",
      fallbackWorkspaceID: "wrk_fallback",
      sessionDirectory: "/worktrees/feature",
      fallbackDirectory: "/repo",
    })
    expect(context).toEqual({ workspace: "wrk_route", directory: "/worktrees/feature" })
  })

  it("omits workspace for detached prompt and command payloads", () => {
    const context = sessionRequestContext({
      fallbackDirectory: "/repo",
      sessionDirectory: "/repo",
    })
    expect(context).toEqual({ workspace: undefined, directory: "/repo" })
  })
})
