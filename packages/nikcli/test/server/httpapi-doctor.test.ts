import { preserveTestEnv } from "../helpers/env"
import { removeTestDir } from "../helpers/fs"
import { afterAll, afterEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-doctor-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

preserveTestEnv(["NIKCLI_TEST_HOME", "NIKCLI_DISABLE_PROJECT_CONFIG"])

const { Instance } = await import("@/project/instance")
const { HttpApiBridge } = await import("@/server/httpapi/bridge")
const { Server } = await import("@/server/server")

const projectDirs: string[] = []

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-doctor-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

async function request(pathname: string, directory: string) {
  const url = new URL(pathname, "http://nikcli.local")
  url.searchParams.set("directory", directory)
  return Server.fetch(new Request(url))
}

describe("Doctor HttpApi", () => {
  it("advertises /doctor as a supported HttpApi path", () => {
    expect(HttpApiBridge.supports("/doctor", "GET")).toBe(true)
    expect(HttpApiBridge.supports("/doctor/", "GET")).toBe(true)
  })

  it("serves GET /doctor via HttpApi when experimental flag is on", async () => {
    const directory = await makeProjectDir()
    const response = await request("/doctor", directory)
    expect(response.status).toBe(200)

    const body = (await response.json()) as {
      ok: boolean
      version: string
      channel: string
      failures: number
      results: Array<{
        ok: boolean
        label: string
        detail?: string
        fix?: string
      }>
    }

    expect(typeof body.version).toBe("string")
    expect(typeof body.channel).toBe("string")
    expect(typeof body.ok).toBe("boolean")
    expect(typeof body.failures).toBe("number")
    expect(Array.isArray(body.results)).toBe(true)
    expect(body.results.length).toBeGreaterThan(0)

    for (const check of body.results) {
      expect(typeof check.ok).toBe("boolean")
      expect(typeof check.label).toBe("string")
    }

    // `failures` must equal the count of failing checks — this is the only
    // bit of derived state the route exposes, so verify it explicitly.
    const failing = body.results.filter((r) => !r.ok).length
    expect(body.failures).toBe(failing)
    expect(body.ok).toBe(failing === 0)
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
