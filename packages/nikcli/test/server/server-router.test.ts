import { describe, expect, it } from "bun:test"
import { companionResponse } from "../../src/server/companion"
import { ServerRouter } from "../../src/server/server-router"
import { Server } from "../../src/server/server"

describe("framework-neutral server router", () => {
  it("serves companion HTML without Hono", async () => {
    const response = companionResponse(new Request("http://nikcli.local/companion?host=https://example.com"))
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/html")
    expect(await response.text()).toContain("const API_BASE = 'https://example.com';")
  })

  it("handles CORS preflight before fallback", async () => {
    let fallbackCalled = false
    const handle = ServerRouter.make({
      fallback: async () => {
        fallbackCalled = true
        return new Response("fallback")
      },
      corsWhitelist: ["https://client.example"],
    })
    const response = await handle(
      new Request("http://nikcli.local/session", {
        method: "OPTIONS",
        headers: { origin: "https://client.example" },
      }),
    )
    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-origin")).toBe("https://client.example")
    expect(response.headers.get("access-control-allow-headers")).toContain("x-nikcli-directory")
    expect(fallbackCalled).toBe(false)
  })

  it("maps framework errors to the existing redacted shape", async () => {
    const response = ServerRouter.mapError(new Error("boom"))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ name: "Unknown", data: { message: "boom" } })
  })

  it("serves the framework-neutral facade through BunHttpServer", async () => {
    const server = await Server.listenEffect({ port: 0, hostname: "127.0.0.1" })
    try {
      const response = await fetch(new URL("/global/health", server.url))
      expect(response.status).toBe(200)
    } finally {
      await server.stop()
    }
  })
})
