import { preserveTestEnv } from "../helpers/env"
import { afterAll, afterEach, describe, expect, it } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-provider-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
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

const { Auth } = await import("@/auth")
const { Instance } = await import("@/project/instance")
const { Server } = await import("@/server/server")

const projectDirs: string[] = []

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-provider-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

async function request(pathname: string, directory: string, init?: RequestInit) {
  const url = new URL(pathname, "http://nikcli.local")
  url.searchParams.set("directory", directory)
  return Server.App().fetch(new Request(url, init))
}

async function getAuth(providerID: string) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      return yield* auth.get(providerID)
    }).pipe(Effect.provide(Auth.defaultLayer)),
  )
}

describe("Provider HttpApi bridge", () => {
  it("serves provider reads and credential mutations behind NIKCLI_EXPERIMENTAL_HTTPAPI", async () => {
    const directory = await makeProjectDir()
    const providerID = "httpapi-provider-test"

    const listResponse = await request("/provider", directory)
    expect(listResponse.status).toBe(200)
    const list = (await listResponse.json()) as {
      all: Array<{ id: string }>
      default: Record<string, string>
      connected: string[]
    }
    expect(Array.isArray(list.all)).toBe(true)
    expect(list.default).toBeObject()
    expect(Array.isArray(list.connected)).toBe(true)

    const authResponse = await request("/provider/auth", directory)
    expect(authResponse.status).toBe(200)
    const methods = (await authResponse.json()) as Record<string, Array<{ type: string; label: string }>>
    expect(methods).toBeObject()

    // OAuth routes are bridged; authorize on a non-OAuth method yields null
    const apiOnly = Object.entries(methods).find(([, list]) => list[0]?.type === "api")
    if (apiOnly) {
      const authorizeResponse = await request(`/provider/${apiOnly[0]}/oauth/authorize`, directory, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: 0 }),
      })
      expect(authorizeResponse.status).toBe(200)
      expect(await authorizeResponse.json()).toBeNull()
    }

    const apiResponse = await request(`/provider/${providerID}/api`, directory, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "test-api-key" }),
    })
    expect(apiResponse.status).toBe(200)
    expect(await apiResponse.json()).toEqual({ success: true })
    expect(await getAuth(providerID)).toEqual({ type: "api", key: "test-api-key" })

    const removeResponse = await request(`/provider/${providerID}/auth`, directory, {
      method: "DELETE",
    })
    expect(removeResponse.status).toBe(200)
    expect(await removeResponse.json()).toEqual({ success: true })
    expect(await getAuth(providerID)).toBeUndefined()
  }, 30_000)
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
