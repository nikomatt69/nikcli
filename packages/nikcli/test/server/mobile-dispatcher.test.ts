import { describe, expect, it } from "bun:test"
import { dispatchMobileRequest } from "@/server/mobile/dispatcher"

describe("mobile framework-neutral dispatcher", () => {
  it("does not claim unrelated routes", async () => {
    expect(await dispatchMobileRequest(new Request("http://nikcli.local/project"))).toBeUndefined()
  })

  it("validates worktree JSON without Hono", async () => {
    const response = await dispatchMobileRequest(
      new Request("http://nikcli.local/mobile/worktree/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    )
    expect(response?.status).toBe(400)
    expect(await response?.json()).toEqual({ error: "Invalid JSON body" })
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

  it("dispatches loop templates without Hono", async () => {
    const response = await dispatchMobileRequest(new Request("http://nikcli.local/mobile/loops/templates"))
    expect(response?.status).toBe(200)
    expect(await response?.json()).toMatchObject({ templates: expect.any(Array) })
  })

  it("validates PTY creation without Hono", async () => {
    const response = await dispatchMobileRequest(
      new Request("http://nikcli.local/mobile/pty", { method: "POST", body: "{" }),
    )
    expect(response?.status).toBe(400)
    expect(await response?.json()).toEqual({ error: "Invalid JSON body" })
  })

  it("leaves PTY websocket connect to the native upgrade path", async () => {
    expect(await dispatchMobileRequest(new Request("http://nikcli.local/mobile/pty/pty_1/connect"))).toBeUndefined()
  })
})
