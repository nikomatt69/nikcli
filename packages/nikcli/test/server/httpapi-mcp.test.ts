import { preserveTestEnv } from "../helpers/env"
import { afterAll, afterEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-mcp-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "0"
process.env.NIKCLI_EXPERIMENTAL_HTTPAPI = "1"
process.env.XDG_DATA_HOME = path.join(testHome, "data")
process.env.XDG_CACHE_HOME = path.join(testHome, "cache")
process.env.XDG_CONFIG_HOME = path.join(testHome, "config")
process.env.XDG_STATE_HOME = path.join(testHome, "state")

preserveTestEnv([
  "NIKCLI_TEST_HOME",
  "NIKCLI_DISABLE_PROJECT_CONFIG",
  "NIKCLI_EXPERIMENTAL_HTTPAPI",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
])

const { Instance } = await import("@/project/instance")
const { Server } = await import("@/server/server")

const projectDirs: string[] = []

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-mcp-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

async function request(pathname: string, directory: string, init?: RequestInit) {
  const url = new URL(pathname, "http://nikcli.local")
  url.searchParams.set("directory", directory)
  const response = await Server.App().fetch(new Request(url, init))
  expect(response.status).toBe(200)
  return response.json()
}

describe("MCP HttpApi bridge", () => {
  it("serves MCP status, add, connect, disconnect, toggle, and auth removal routes", async () => {
    const directory = await makeProjectDir()
    await fs.writeFile(
      path.join(directory, "nikcli.json"),
      JSON.stringify({
        mcp: {
          "effect-disabled": {
            type: "local",
            command: ["bun", "--version"],
            enabled: false,
            timeout: 100,
          },
        },
      }),
    )

    const initial = (await request("/mcp", directory)) as Record<string, { status: string }>
    expect(initial["effect-disabled"]).toEqual({ status: "disabled" })

    const added = (await request("/mcp", directory, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "runtime-disabled",
        config: {
          type: "local",
          command: ["bun", "--version"],
          enabled: false,
          timeout: 100,
        },
      }),
    })) as Record<string, { status: string }>
    expect(added["runtime-disabled"]).toEqual({ status: "disabled" })

    const connect = (await request("/mcp/effect-disabled/connect", directory, { method: "POST" })) as boolean
    expect(connect).toBe(true)

    const disconnect = (await request("/mcp/effect-disabled/disconnect", directory, { method: "POST" })) as boolean
    expect(disconnect).toBe(true)
    const afterDisconnect = (await request("/mcp", directory)) as Record<string, { status: string }>
    expect(afterDisconnect["effect-disabled"]).toEqual({ status: "disabled" })

    const toggled = (await request("/mcp/effect-disabled/toggle", directory, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    })) as Record<string, { status: string }>
    expect(toggled["effect-disabled"]).toEqual({ status: "disabled" })

    const removed = (await request("/mcp/effect-disabled/auth", directory, { method: "DELETE" })) as { success: true }
    expect(removed).toEqual({ success: true })
  })
})

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

afterAll(async () => {
  delete process.env.NIKCLI_EXPERIMENTAL_HTTPAPI
  await Instance.disposeAll().catch(() => undefined)
  await Promise.all(projectDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  await fs.rm(testHome, { recursive: true, force: true })
})
