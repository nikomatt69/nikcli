import { preserveTestEnv } from "../helpers/env"
import { removeTestDir } from "../helpers/fs"
import { afterAll, afterEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-top-level-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
process.env.NIKCLI_EXPERIMENTAL_HTTPAPI = "1"

preserveTestEnv(["NIKCLI_TEST_HOME", "NIKCLI_DISABLE_PROJECT_CONFIG", "NIKCLI_EXPERIMENTAL_HTTPAPI"])

const { Instance } = await import("@/project/instance")
const { Server } = await import("@/server/server")

const projectDirs: string[] = []

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-top-level-project-"))
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

describe("Top-level HttpApi bridge", () => {
  it("serves implemented top-level read routes behind NIKCLI_EXPERIMENTAL_HTTPAPI", async () => {
    const directory = await makeProjectDir()

    const paths = (await request("/path", directory)) as {
      directory: string
      worktree: string
      home: string
      state: string
      config: string
    }
    expect(paths.directory).toBe(directory)
    expect(paths.worktree).toBeString()
    expect(paths.home).toBe(testHome)

    const vcs = (await request("/vcs", directory)) as { branch?: string }
    expect(vcs).toBeObject()

    const commands = (await request("/command", directory)) as Array<{ name: string; hints: string[] }>
    expect(commands.some((command) => command.name === "init")).toBe(true)

    const agents = (await request("/agent", directory)) as Array<{ name: string; mode: string }>
    expect(agents.length).toBeGreaterThan(0)
    expect(agents.every((agent) => typeof agent.name === "string" && typeof agent.mode === "string")).toBe(true)

    const skills = (await request("/skill", directory)) as Array<{ name: string; location: string }>
    expect(Array.isArray(skills)).toBe(true)

    const lsp = (await request("/lsp", directory)) as Array<{ id: string; status: string }>
    expect(Array.isArray(lsp)).toBe(true)

    const formatter = (await request("/formatter", directory)) as Array<{ name: string; enabled: boolean }>
    expect(Array.isArray(formatter)).toBe(true)

    const disposed = (await request("/instance/dispose", directory, { method: "POST" })) as boolean
    expect(disposed).toBe(true)

    const pathsAfterDispose = (await request("/path", directory)) as { directory: string }
    expect(pathsAfterDispose.directory).toBe(directory)
  })

  it("serves VCS status, raw diff, and apply through HttpApi", async () => {
    const directory = await makeProjectDir()

    const status = (await request("/vcs/status", directory)) as Array<{ file: string }>
    expect(Array.isArray(status)).toBe(true)

    const url = new URL("/vcs/diff/raw", "http://nikcli.local")
    url.searchParams.set("directory", directory)
    const diff = await Server.App().fetch(new Request(url))
    expect(diff.status).toBe(200)
    expect(diff.headers.get("content-type")).toContain("text/x-diff")
    expect(typeof (await diff.text())).toBe("string")

    // Applying a patch to a non-git project dir must return the legacy
    // { name: "VcsApplyError", data: { message, reason } } 400 body.
    const applyUrl = new URL("/vcs/apply", "http://nikcli.local")
    applyUrl.searchParams.set("directory", directory)
    const apply = await Server.App().fetch(
      new Request(applyUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ patch: "diff --git a/x b/x\n" }),
      }),
    )
    expect(apply.status).toBe(400)
    const applyBody = (await apply.json()) as {
      name: string
      data: { message: string; reason: string }
    }
    expect(applyBody.name).toBe("VcsApplyError")
    expect(applyBody.data.reason).toBe("non-git")
  })
})

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

afterAll(async () => {
  delete process.env.NIKCLI_EXPERIMENTAL_HTTPAPI
  await Instance.disposeAll().catch(() => undefined)
  await Promise.all(projectDirs.map((dir) => removeTestDir(dir)))
  await removeTestDir(testHome)
})
