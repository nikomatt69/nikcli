import { describe, expect, it } from "bun:test"
import { dispatchMobileRequest } from "@/server/mobile/dispatcher"

describe("mobile framework-neutral dispatcher", () => {
  it("does not claim unrelated routes", async () => {
    expect(await dispatchMobileRequest(new Request("http://nikcli.local/project"))).toBeUndefined()
  })

  it("preserves unknown upload status and JSON headers", async () => {
    const response = await dispatchMobileRequest(
      new Request("http://nikcli.local/mobile/teleport/upload/missing", {
        method: "POST",
        body: new Uint8Array([1, 2, 3]),
      }),
    )
    expect(response?.status).toBe(404)
    expect(response?.headers.get("content-type")).toContain("application/json")
    expect(await response?.json()).toEqual({ error: "Unknown upload" })
  })

  it("returns undefined for an unmatched mobile route", async () => {
    expect(await dispatchMobileRequest(new Request("http://nikcli.local/mobile/not-a-real-route"))).toBeUndefined()
  })

  it("leaves PTY websocket connect to the native upgrade path", async () => {
    expect(await dispatchMobileRequest(new Request("http://nikcli.local/mobile/pty/pty_1/connect"))).toBeUndefined()
  })

  it("does not claim JSON routes that moved to the encoded router", async () => {
    // H7: every JSON /mobile/* endpoint is an encoded `.handle` on the mobile
    // group; the dispatcher only answers the SSE streams and the teleport
    // chunk upload, so these all fall through.
    const jsonRoutes: Array<[path: string, init: RequestInit]> = [
      ["/mobile/worktree/reset", { method: "POST", headers: { "content-type": "application/json" }, body: "{" }],
      ["/mobile/pty", { method: "POST", headers: { "content-type": "application/json" }, body: "{" }],
      ["/mobile/loops/templates", {}],
      ["/mobile/missions/templates", {}],
      ["/mobile/github/repos", {}],
      ["/mobile/session", { method: "GET" }],
    ]
    for (const [path, init] of jsonRoutes)
      expect(await dispatchMobileRequest(new Request(`http://nikcli.local${path}`, init))).toBeUndefined()
  })
})
