import { preserveTestEnv } from "../helpers/env"
import { removeTestDir } from "../helpers/fs"
import { afterAll, afterEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-project-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

preserveTestEnv(["NIKCLI_TEST_HOME", "NIKCLI_DISABLE_PROJECT_CONFIG"])

const { Instance } = await import("@/project/instance")
const { Server } = await import("@/server/server")

const projectDirs: string[] = []

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-project-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

async function request(pathname: string, directory: string, init?: RequestInit) {
  const url = new URL(pathname, "http://nikcli.local")
  url.searchParams.set("directory", directory)
  return Server.fetch(new Request(url, init))
}

describe("Project HttpApi bridge", () => {
  it("serves current, list, and update project routes via Server.fetch", async () => {
    const directory = await makeProjectDir()

    const currentResponse = await request("/project/current", directory)
    expect(currentResponse.status).toBe(200)
    const current = (await currentResponse.json()) as { id: string; worktree: string }
    expect(current.id).toBe("global")
    expect(current.worktree).toBeString()

    const listResponse = await request("/project", directory)
    expect(listResponse.status).toBe(200)
    const list = (await listResponse.json()) as Array<{ id: string }>
    expect(list.some((project) => project.id === current.id)).toBe(true)

    const updateResponse = await request(`/project/${current.id}`, directory, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "HttpApi Project" }),
    })
    expect(updateResponse.status).toBe(200)
    const updated = (await updateResponse.json()) as { id: string; name?: string }
    expect(updated.id).toBe(current.id)
    expect(updated.name).toBe("HttpApi Project")
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
