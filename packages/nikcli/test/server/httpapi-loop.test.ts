import { preserveTestEnv } from "../helpers/env"
import { removeTestDir } from "../helpers/fs"
import { afterAll, afterEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-loop-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

preserveTestEnv(["NIKCLI_TEST_HOME", "NIKCLI_DISABLE_PROJECT_CONFIG"])

const { Instance } = await import("@/project/instance")
const { HttpApiBridge } = await import("@/server/httpapi/bridge")
const { Server } = await import("@/server/server")

void HttpApiBridge

const projectDirs: string[] = []

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-loop-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

async function request(pathname: string, directory: string, init?: RequestInit) {
  const url = new URL(pathname, "http://nikcli.local")
  url.searchParams.set("directory", directory)
  return Server.fetch(new Request(url, init))
}

function loopBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "test-loop",
    stages: [{ id: "s1", name: "stage-1", agent: "general", prompt: "Do the thing" }],
    trigger: { kind: "manual" },
    ...overrides,
  }
}

describe("Loop HttpApi bridge", () => {
  it("serves the loop list", async () => {
    const directory = await makeProjectDir()
    const response = await request("/loop", directory)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { loops: unknown[]; runtimes: unknown[] }
    expect(Array.isArray(body.loops)).toBe(true)
    expect(Array.isArray(body.runtimes)).toBe(true)
  })

  /**
   * E5 regression. `stages: []` clears the handler's `validateDefinition`
   * pre-check (that loop is simply empty) and then trips
   * `LoopDefinitionSchema`'s `.min(1)` inside `sanitizeDefinition`, so
   * `Manager.upsert` throws. Wrapped in `Effect.promise(...).pipe(Effect.orDie)`
   * that surfaced as a 500 defect even though the route declares a 400.
   */
  it("maps an upsert rejection past the pre-check onto the declared 400", async () => {
    const directory = await makeProjectDir()
    const response = await request("/loop", directory, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(loopBody({ stages: [] })),
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as { name: string; data: { message?: string } }
    expect(body.name).toBe("ValidationError")
    expect(body.data.message).toBe("Invalid loop definition")
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
