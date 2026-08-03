import { preserveTestEnv } from "../helpers/env"
import { afterAll, afterEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const home = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-perm-home-"))
process.env.NIKCLI_TEST_HOME = home
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
process.env.XDG_DATA_HOME = path.join(home, "data")
process.env.XDG_CACHE_HOME = path.join(home, "cache")
process.env.XDG_CONFIG_HOME = path.join(home, "config")
process.env.XDG_STATE_HOME = path.join(home, "state")

preserveTestEnv([
  "NIKCLI_TEST_HOME",
  "NIKCLI_DISABLE_PROJECT_CONFIG",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
])

const { PermissionNext } = await import("@/permission/next")

const projectDirs: string[] = []
async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-perm-proj-"))
  projectDirs.push(dir)
  return dir
}

afterEach(async () => {
  const { Instance } = await import("@/project/instance")
  await Instance.disposeAll().catch(() => undefined)
})

afterAll(async () => {
  await Promise.all(projectDirs.map((d) => fs.rm(d, { recursive: true, force: true })))
  await fs.rm(home, { recursive: true, force: true })
})

describe("PermissionNext namespace (opencode #22047 wiring)", () => {
  it("Service is a class constructor (Effect.Service)", () => {
    // Service is `Context.Service(...)` → a class function.
    expect(typeof PermissionNext.Service).toBe("function")
  })

  it("Request + Action schemas exported", () => {
    expect(typeof PermissionNext.Request).toBe("object")
    expect(PermissionNext.Action).toBeDefined()
  })

  it("an empty project directory can be created", async () => {
    const dir = await makeProjectDir()
    expect((await fs.stat(dir)).isDirectory()).toBe(true)
  })
})
