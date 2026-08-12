import { preserveTestEnv } from "../helpers/env"
import { removeTestDir } from "../helpers/fs"
import { afterAll, afterEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-contract-extra-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_TEST_MODE = "1"
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "0"
process.env.NIKCLI_DISABLE_MODELS_FETCH = "1"
process.env.XDG_DATA_HOME = path.join(testHome, "data")
process.env.XDG_CACHE_HOME = path.join(testHome, "cache")
process.env.XDG_CONFIG_HOME = path.join(testHome, "config")
process.env.XDG_STATE_HOME = path.join(testHome, "state")

preserveTestEnv([
  "NIKCLI_TEST_HOME",
  "NIKCLI_TEST_MODE",
  "NIKCLI_DISABLE_PROJECT_CONFIG",
  "NIKCLI_DISABLE_MODELS_FETCH",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
])

for (const dir of ["data", "cache", "config", "state"]) {
  await fs.mkdir(path.join(testHome, dir), { recursive: true })
}

const { Config } = await import("@/config/config")
const { Instance } = await import("@/project/instance")
const { HttpApiBridge } = await import("@/server/httpapi/bridge")
const { handlerRoutes, rawRouteImplementations, routeKey } = await import("@/server/httpapi/inventory")
const { Server } = await import("@/server/server")

const projectDirs: string[] = []

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-contract-extra-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

function request(directory: string, pathname: string, method = "GET", payload?: unknown) {
  const url = new URL(pathname, "http://nikcli.local")
  url.searchParams.set("directory", directory)
  return Server.fetch(
    new Request(url, {
      method,
      headers: payload === undefined ? undefined : { "content-type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    }),
  )
}

describe("ContractExtra HttpApi handlers", () => {
  it("keeps non-WebSocket contract-extra routes as raw implementations", () => {
    const served = new Set(handlerRoutes().map(routeKey))
    const expected = [
      "PUT /auth/{providerID}",
      "DELETE /auth/{providerID}",
      "POST /config/reload",
      "POST /config/mcp",
      "PATCH /config/mcp/{name}",
      "DELETE /config/mcp/{name}",
      "POST /config/profiles",
      "POST /config/profiles/activate/{name}",
      "POST /session/{sessionID}/message",
      "POST /session/{sessionID}/prompt_async",
      "GET /s/{shareID}",
      "GET /share/{shareID}",
      "GET /api/share/{shareID}",
      "GET /api/share/{shareID}/data",
      "GET /event",
      "GET /global/event",
      "GET /experimental/workspace/{id}/events",
      "POST /experimental/workspace/session/{sessionID}/warp",
      "POST /user/register",
      "POST /user/login",
      "PATCH /user/{id}",
    ]

    for (const key of expected) {
      expect(served.has(key), key).toBe(false)
      expect(rawRouteImplementations.has(key), key).toBe(true)
    }
    expect(served.has("GET /pty/{ptyID}/connect")).toBe(false)
    expect(rawRouteImplementations.has("GET /pty/{ptyID}/connect")).toBe(true)
    expect(HttpApiBridge.supports("/auth/openai", "PUT")).toBe(true)
    expect(HttpApiBridge.supports("/auth/openai", "DELETE")).toBe(true)
  })

  it("persists MCP CRUD and profile activation through the Effect handlers", async () => {
    const directory = await makeProjectDir()
    const local = { type: "local", command: ["bun", "server.ts"] }

    const add = await request(directory, "/config/mcp", "POST", { name: "demo", config: local })
    expect(add.status).toBe(200)
    expect(await add.json()).toEqual({ success: true })

    const update = await request(directory, "/config/mcp/demo", "PATCH", { enabled: false })
    expect(update.status).toBe(200)
    expect(await update.json()).toEqual({ success: true })

    const missing = await request(directory, "/config/mcp/missing", "PATCH", { enabled: true })
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: "MCP server not found" })

    const createProfile = await request(directory, "/config/profiles", "POST", { name: "saved" })
    expect(createProfile.status).toBe(200)
    expect(await createProfile.json()).toEqual({ success: true })

    await fs.writeFile(path.join(directory, "nikcli.json"), JSON.stringify({ theme: "changed" }))
    const activate = await request(directory, "/config/profiles/activate/saved", "POST")
    expect(activate.status).toBe(200)
    expect(await activate.json()).toEqual({ success: true })
    expect(JSON.parse(await fs.readFile(path.join(directory, "nikcli.json"), "utf8"))).toEqual(
      expect.objectContaining({ mcp: { demo: expect.objectContaining({ enabled: false }) } }),
    )
    expect(await Bun.file(path.join(Config.managedConfigDir(), "profiles", "active")).text()).toBe("saved")

    const remove = await request(directory, "/config/mcp/demo", "DELETE")
    expect(remove.status).toBe(200)
    expect(await remove.json()).toEqual({ success: true })
    const persisted = JSON.parse(await fs.readFile(path.join(directory, "nikcli.json"), "utf8")) as {
      mcp?: Record<string, unknown>
    }
    expect(persisted.mcp).toEqual({})
  })
})

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

afterAll(async () => {
  await Instance.disposeAll().catch(() => undefined)
  await Promise.all(projectDirs.map((dir) => removeTestDir(dir)))
  await removeTestDir(testHome)
})
