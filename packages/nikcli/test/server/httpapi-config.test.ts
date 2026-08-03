import { preserveTestEnv } from "../helpers/env"
import { afterAll, afterEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-config-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "0"
process.env.NIKCLI_DISABLE_MODELS_FETCH = "1"
process.env.NIKCLI_EXPERIMENTAL_HTTPAPI = "1"
process.env.XDG_DATA_HOME = path.join(testHome, "data")
process.env.XDG_CACHE_HOME = path.join(testHome, "cache")
process.env.XDG_CONFIG_HOME = path.join(testHome, "config")
process.env.XDG_STATE_HOME = path.join(testHome, "state")

preserveTestEnv([
  "NIKCLI_TEST_HOME",
  "NIKCLI_DISABLE_PROJECT_CONFIG",
  "NIKCLI_DISABLE_MODELS_FETCH",
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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-config-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

async function request(pathname: string, directory: string, init?: RequestInit) {
  const url = new URL(pathname, "http://nikcli.local")
  url.searchParams.set("directory", directory)
  return Server.App().fetch(new Request(url, init))
}

describe("Config HttpApi bridge", () => {
  it("serves get, update, and provider summary routes behind NIKCLI_EXPERIMENTAL_HTTPAPI", async () => {
    const directory = await makeProjectDir()

    const initialResponse = await request("/config", directory)
    expect(initialResponse.status).toBe(200)
    const initial = (await initialResponse.json()) as { plugin?: string[] }
    expect(initial.plugin).toEqual([])

    const updateResponse = await request("/config", directory, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ theme: "httpapi-config-test" }),
    })
    expect(updateResponse.status).toBe(200)
    const updated = (await updateResponse.json()) as { theme?: string }
    expect(updated.theme).toBe("httpapi-config-test")

    const reloadedResponse = await request("/config", directory)
    expect(reloadedResponse.status).toBe(200)
    const reloaded = (await reloadedResponse.json()) as { theme?: string }
    expect(reloaded.theme).toBe("httpapi-config-test")

    const providersResponse = await request("/config/providers", directory)
    expect(providersResponse.status).toBe(200)
    const providers = (await providersResponse.json()) as {
      providers: Array<{ id: string; models: Record<string, unknown> }>
      default: Record<string, string>
    }
    expect(Array.isArray(providers.providers)).toBe(true)
    expect(providers.providers.every((provider) => typeof provider.id === "string")).toBe(true)
    expect(providers.default).toBeObject()
  })

  it("returns the declared 400 body when the existing config file is unparsable", async () => {
    const directory = await makeProjectDir()

    // boot the instance with a valid (absent) config first — a broken file
    // at bootstrap would fail instance creation before the route runs
    const bootResponse = await request("/config", directory)
    expect(bootResponse.status).toBe(200)

    await fs.writeFile(path.join(directory, "nikcli.json"), "{ not json", "utf8")

    const response = await request("/config", directory, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ theme: "httpapi-config-test" }),
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as { name: string; data: Record<string, unknown> }
    expect(body.name).toBe("ConfigJsonError")
    expect(String(body.data.path)).toContain("nikcli.json")
  })

  it("serves configs whose parsed shape carries undefined fields (agent steps)", async () => {
    const directory = await makeProjectDir()

    // The config agent transform sets `steps: agent.steps ?? agent.maxSteps`,
    // leaving an explicit `steps: undefined` key that the HttpApi JSON encoder
    // rejected before the jsonSafe boundary (regression: GET /config → 400).
    await fs.writeFile(
      path.join(directory, "nikcli.json"),
      JSON.stringify({ agent: { probe: { prompt: "probe agent" } } }),
      "utf8",
    )

    const response = await request("/config", directory)
    expect(response.status).toBe(200)
    const config = (await response.json()) as { agent?: Record<string, { prompt?: string }> }
    expect(config.agent?.probe?.prompt).toBe("probe agent")
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
