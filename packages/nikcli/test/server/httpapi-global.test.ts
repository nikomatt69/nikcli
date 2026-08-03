import { preserveTestEnv } from "../helpers/env"
import { afterAll, afterEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-global-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
process.env.NIKCLI_EXPERIMENTAL_HTTPAPI = "1"

preserveTestEnv(["NIKCLI_TEST_HOME", "NIKCLI_DISABLE_PROJECT_CONFIG", "NIKCLI_EXPERIMENTAL_HTTPAPI"])

const { Instance } = await import("@/project/instance")
const { HttpApiBridge } = await import("@/server/httpapi/bridge")
const { Installation } = await import("@/installation")
const { Server } = await import("@/server/server")

async function request(pathname: string, init?: RequestInit) {
  const url = new URL(pathname, "http://nikcli.local")
  return Server.App().fetch(new Request(url, init))
}

describe("Global HttpApi", () => {
  it("advertises global routes on the instance-less bridge branch only", () => {
    expect(HttpApiBridge.supportsGlobal("/global/health", "GET")).toBe(true)
    expect(HttpApiBridge.supportsGlobal("/global/event", "GET")).toBe(true)
    expect(HttpApiBridge.supportsGlobal("/global/dispose", "POST")).toBe(true)
    expect(HttpApiBridge.supportsGlobal("/global/health", "POST")).toBe(false)
    // The instance bridge must not claim /global — it would provide
    // instance context that does not exist for these requests.
    expect(HttpApiBridge.supports("/global/health", "GET")).toBe(false)
    expect(HttpApiBridge.supports("/global/dispose", "POST")).toBe(false)
  })

  it("serves GET /global/health without instance context", async () => {
    const response = await request("/global/health")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      healthy: true,
      version: Installation.VERSION,
    })
  })

  it("serves POST /global/dispose without instance context", async () => {
    const response = await request("/global/dispose", { method: "POST" })
    expect(response.status).toBe(200)
    expect(await response.json()).toBe(true)
  })

  it("serves GET /global/event as an SSE stream", async () => {
    const response = await request("/global/event")
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("text/event-stream")

    const reader = response.body!.getReader()
    const { value } = await reader.read()
    const chunk = new TextDecoder().decode(value)
    expect(chunk).toContain("server.connected")
    await reader.cancel()
  })
})

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

afterAll(async () => {
  delete process.env.NIKCLI_EXPERIMENTAL_HTTPAPI
  await Instance.disposeAll().catch(() => undefined)
  await fs.rm(testHome, { recursive: true, force: true })
})
