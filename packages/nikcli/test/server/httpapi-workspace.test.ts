import { afterAll, afterEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-workspace-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
process.env.NIKCLI_EXPERIMENTAL_HTTPAPI = "1"
process.env.XDG_DATA_HOME = path.join(testHome, "data")
process.env.XDG_CACHE_HOME = path.join(testHome, "cache")
process.env.XDG_CONFIG_HOME = path.join(testHome, "config")
process.env.XDG_STATE_HOME = path.join(testHome, "state")

const { Instance } = await import("@/project/instance")
const { HttpApiBridge } = await import("@/server/httpapi/bridge")
const { Server } = await import("@/server/server")

const projectDirs: string[] = []

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-workspace-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

async function git(directory: string, ...args: string[]) {
  const proc = Bun.spawn(["git", ...args], { cwd: directory, stdout: "pipe", stderr: "pipe" })
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  if (exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${stderr || stdout}`)
  }
}

async function makeGitProjectDir() {
  const directory = await makeProjectDir()
  await git(directory, "init")
  await fs.writeFile(path.join(directory, "README.md"), "# workspace test\n")
  await git(directory, "add", "README.md")
  await git(directory, "-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", "initial")
  return directory
}

async function request(pathname: string, directory: string, params: Record<string, string> = {}) {
  process.env.NIKCLI_EXPERIMENTAL_HTTPAPI = "1"
  const url = new URL(pathname, "http://nikcli.local")
  url.searchParams.set("directory", directory)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  const response = await Server.App().fetch(new Request(url))
  if (response.status !== 200) {
    throw new Error(`Expected ${pathname} to return 200, got ${response.status}: ${await response.text()}`)
  }
  return response.json()
}

async function jsonRequest(
  method: string,
  pathname: string,
  directory: string,
  body?: unknown,
  expectedStatus = 200,
) {
  process.env.NIKCLI_EXPERIMENTAL_HTTPAPI = "1"
  const url = new URL(pathname, "http://nikcli.local")
  url.searchParams.set("directory", directory)
  const headers = new Headers()
  if (body !== undefined) headers.set("content-type", "application/json")
  const response = await Server.App().fetch(
    new Request(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
  if (response.status !== expectedStatus) {
    throw new Error(
      `Expected ${method} ${pathname} to return ${expectedStatus}, got ${response.status}: ${await response.text()}`,
    )
  }
  if (expectedStatus === 204) return null
  return response.json()
}

async function post(pathname: string, directory: string, body?: unknown, expectedStatus = 200) {
  return jsonRequest("POST", pathname, directory, body, expectedStatus)
}

async function remove(pathname: string, directory: string) {
  return jsonRequest("DELETE", pathname, directory)
}

describe("Workspace HttpApi bridge", () => {
  it("serves workspace adaptor, create, restore, session restore, list, and remove routes", async () => {
    const directory = await makeGitProjectDir()
    const workspaceID = "wrk_httpapi_workspace"

    expect(HttpApiBridge.supports("/experimental/workspace/adaptor", "GET")).toBe(true)
    const adaptors = (await request("/experimental/workspace/adaptor", directory)) as Array<{
      type: string
      name: string
      description: string
      available?: boolean
    }>
    expect(adaptors).toContainEqual({
      type: "worktree",
      name: "Worktree",
      description: "Create a local git worktree",
      available: true,
    })
    expect(adaptors).toContainEqual({
      type: "container",
      name: "Container",
      description: "Docker/Podman container",
      available: true,
    })

    expect(HttpApiBridge.supports("/experimental/workspace", "GET")).toBe(true)
    let workspaces = (await request("/experimental/workspace", directory)) as unknown[]
    expect(workspaces).toEqual([])

    expect(HttpApiBridge.supports(`/experimental/workspace/${workspaceID}`, "POST")).toBe(true)
    const created = (await post(`/experimental/workspace/${workspaceID}`, directory, {
      branch: "httpapi-workspace",
      config: {
        type: "worktree",
        directory,
      },
    })) as { id: string; projectID: string; branch: string | null; config: { type: string; directory: string } }
    expect(created).toEqual(
      expect.objectContaining({
        id: workspaceID,
        branch: "httpapi-workspace",
        config: expect.objectContaining({ type: "worktree" }),
      }),
    )

    workspaces = (await request("/experimental/workspace", directory)) as unknown[]
    expect(workspaces).toContainEqual(expect.objectContaining({ id: workspaceID }))

    expect(HttpApiBridge.supports(`/experimental/workspace/${workspaceID}/restore`, "POST")).toBe(true)
    const restored = (await post(`/experimental/workspace/${workspaceID}/restore`, directory)) as {
      workspaceID: string
      sessions: string[]
      events: unknown[]
    }
    expect(restored).toEqual({ workspaceID, sessions: [], events: [] })

    const session = (await post("/session", directory, { title: "Workspace session" })) as { id: string }
    expect(HttpApiBridge.supports(`/experimental/workspace/${workspaceID}/session/${session.id}/restore`, "POST")).toBe(
      true,
    )
    const sessionRestored = (await post(
      `/experimental/workspace/${workspaceID}/session/${session.id}/restore`,
      directory,
    )) as { workspaceID: string; sessionID: string; sessions: string[]; events: unknown[] }
    expect(sessionRestored).toEqual({
      workspaceID,
      sessionID: session.id,
      sessions: [session.id],
      events: [],
    })

    expect(HttpApiBridge.supports("/experimental/workspace/warp", "POST")).toBe(true)
    await post("/experimental/workspace/warp", directory, { id: null, sessionID: session.id }, 204)
    const detached = (await request(`/session/${session.id}`, directory)) as { workspaceID?: string }
    expect(detached.workspaceID).toBeUndefined()

    await post("/experimental/workspace/warp", directory, { id: workspaceID, sessionID: session.id }, 204)
    const warped = (await request(`/session/${session.id}`, directory)) as { workspaceID?: string }
    expect(warped.workspaceID).toBe(workspaceID)

    expect(HttpApiBridge.supports(`/experimental/workspace/${workspaceID}`, "DELETE")).toBe(true)
    const removed = (await remove(`/experimental/workspace/${workspaceID}`, directory)) as { id: string } | null
    expect(removed).toEqual(expect.objectContaining({ id: workspaceID }))

    workspaces = (await request("/experimental/workspace", directory)) as unknown[]
    expect(workspaces).toEqual([])
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
