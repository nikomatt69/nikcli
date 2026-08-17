import { preserveTestEnv } from "../helpers/env"
import { afterAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-mobile-events-host-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_TEST_MODE = "1"
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
process.env.XDG_DATA_HOME = path.join(testHome, "data")
process.env.XDG_CACHE_HOME = path.join(testHome, "cache")
process.env.XDG_CONFIG_HOME = path.join(testHome, "config")
process.env.XDG_STATE_HOME = path.join(testHome, "state")

preserveTestEnv([
  "NIKCLI_TEST_HOME",
  "NIKCLI_TEST_MODE",
  "NIKCLI_DISABLE_PROJECT_CONFIG",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
])
for (const dir of ["data", "cache", "config", "state"]) {
  await fs.mkdir(path.join(testHome, dir), { recursive: true })
}

const projectDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-mobile-events-host-project-")))
const { Instance } = await import("@/project/instance")
const { Server } = await import("@/server/server")

function request(pathname: string, init?: RequestInit) {
  return Server.fetch(
    new Request(`http://nikcli.local${pathname}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-nikcli-directory": projectDir,
        ...init?.headers,
      },
    }),
  )
}

afterAll(async () => {
  await Instance.disposeAll().catch(() => undefined)
  await fs.rm(testHome, { recursive: true, force: true })
  await fs.rm(projectDir, { recursive: true, force: true })
})

describe("mobile events and host status", () => {
  it("streams an allowlisted SSE greeting on /mobile/events", async () => {
    const response = await request("/mobile/events")
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    expect(response.body).toBeTruthy()
    const reader = response.body!.getReader()
    const { value } = await reader.read()
    const chunk = new TextDecoder().decode(value)
    expect(chunk).toContain("server.connected")
    await reader.cancel()
  })

  it("returns a capability envelope when host Island is unavailable", async () => {
    const response = await request("/mobile/host/island")
    expect(response.status).toBe(200)
    const body = (await response.json()) as { available: boolean; reason?: string }
    expect(typeof body.available).toBe("boolean")
    if (!body.available) expect(typeof body.reason).toBe("string")
  })

  it("returns host process telemetry for DevTools", async () => {
    const response = await request("/mobile/host/devtools")
    expect(response.status).toBe(200)
    const body = (await response.json()) as { available: boolean; rss?: number; pid?: number }
    expect(body.available).toBe(true)
    expect(typeof body.rss).toBe("number")
    expect(typeof body.pid).toBe("number")
  })
})
