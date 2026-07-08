import { describe, expect, it } from "bun:test"
import { ServerBackend } from "@/server/backend"
import { HttpApiBridge } from "@/server/httpapi/bridge"

describe("ServerBackend", () => {
  it("exposes the Effect HttpApi web handler for the future pure backend", () => {
    expect(typeof HttpApiBridge.webHandler).toBe("function")
    expect(HttpApiBridge.layer).toBeDefined()
  })

  it("keeps Hono when the experimental HttpApi flag is disabled", () => {
    const decision = ServerBackend.decide({
      experimentalHttpApi: false,
      path: "/doctor",
      method: "GET",
      supports: () => true,
    })
    expect(decision).toEqual({ kind: "hono", reason: "flag-disabled" })
  })

  it("keeps Hono for unsupported paths when the flag is enabled", () => {
    const decision = ServerBackend.decide({
      experimentalHttpApi: true,
      path: "/mobile/status",
      method: "GET",
      supports: () => false,
    })
    expect(decision).toEqual({ kind: "hono", reason: "unsupported-route" })
  })

  it("selects the Effect HttpApi bridge for supported paths when enabled", () => {
    const decision = ServerBackend.decide({
      experimentalHttpApi: true,
      path: "/doctor",
      method: "GET",
      supports: () => true,
    })
    expect(decision).toEqual({
      kind: "effect-httpapi-bridge",
      reason: "supported-route",
    })
  })

  it("selects the global Effect HttpApi bridge for supported global paths", () => {
    const decision = ServerBackend.decideGlobal({
      experimentalHttpApi: true,
      path: "/user/status",
      method: "GET",
      supportsGlobal: () => true,
    })
    expect(decision).toEqual({
      kind: "effect-httpapi-bridge",
      reason: "supported-route",
    })
  })

  it("lists first JSON-only Hono deletion candidates", () => {
    expect(ServerBackend.deletionGroup("doctor")?.status).toBe("candidate")
    expect(ServerBackend.deletionGroup("analytics")?.status).toBe("candidate")
    expect(ServerBackend.deletionGroup("brain")?.status).toBe("candidate")
    expect(ServerBackend.deletionGroup("connectors")?.status).toBe("candidate")
  })

  it("keeps raw/special Hono surfaces blocked", () => {
    expect(ServerBackend.deletionGroup("pty-websocket")?.status).toBe("blocked")
    expect(ServerBackend.deletionGroup("sync-stream")?.status).toBe("blocked")
    expect(ServerBackend.deletionGroup("companion-mobile")?.status).toBe("blocked")
  })

  it("does not allow candidate Hono deletion before SDK defaults to Effect OpenAPI", () => {
    expect(ServerBackend.canDeleteHonoGroup("doctor", { sdkDefaultHttpApi: false })).toBe(false)
    expect(ServerBackend.canDeleteHonoGroup("doctor", { sdkDefaultHttpApi: true })).toBe(true)
    expect(
      ServerBackend.canDeleteHonoGroup("sync-stream", {
        sdkDefaultHttpApi: true,
      }),
    ).toBe(false)
  })
})
