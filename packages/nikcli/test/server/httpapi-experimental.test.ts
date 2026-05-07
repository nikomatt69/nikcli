import { afterAll, afterEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-experimental-home-"))
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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-experimental-project-"))
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
  await fs.writeFile(path.join(directory, "README.md"), "# experimental worktree test\n")
  await git(directory, "add", "README.md")
  await git(directory, "-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", "initial")
  return directory
}

async function request(pathname: string, directory: string, params: Record<string, string> = {}) {
  const url = new URL(pathname, "http://nikcli.local")
  url.searchParams.set("directory", directory)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  const response = await Server.App().fetch(new Request(url))
  expect(response.status).toBe(200)
  return response.json()
}

async function jsonRequest(method: string, pathname: string, directory: string, body: unknown) {
  const url = new URL(pathname, "http://nikcli.local")
  url.searchParams.set("directory", directory)
  const response = await Server.App().fetch(
    new Request(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  )
  if (response.status !== 200) {
    throw new Error(`Expected ${method} ${pathname} to return 200, got ${response.status}: ${await response.text()}`)
  }
  return response.json()
}

describe("Experimental HttpApi bridge", () => {
  it("serves read-only experimental tool, worktree, and resource routes", async () => {
    const directory = await makeProjectDir()

    const ids = (await request("/experimental/tool/ids", directory)) as string[]
    expect(ids).toContain("bash")
    expect(ids).toContain("read")

    const tools = (await request("/experimental/tool", directory, {
      provider: "openai",
      model: "gpt-5",
    })) as Array<{ id: string; description: string; parameters: unknown }>
    expect(tools).toContainEqual(
      expect.objectContaining({
        id: "bash",
        description: expect.any(String),
      }),
    )

    const worktrees = (await request("/experimental/worktree", directory)) as string[]
    expect(Array.isArray(worktrees)).toBe(true)

    const resources = (await request("/experimental/resource", directory)) as Record<string, unknown>
    expect(resources).toEqual({})
  })

  it("serves experimental worktree create, reset, and remove routes", async () => {
    const directory = await makeGitProjectDir()

    expect(HttpApiBridge.supports("/experimental/worktree", "POST")).toBe(true)
    const created = (await jsonRequest("POST", "/experimental/worktree", directory, {
      name: "httpapi-experimental",
      branch: "httpapi-experimental",
    })) as { name: string; branch: string; directory: string }
    expect(created).toEqual(
      expect.objectContaining({
        name: "httpapi-experimental",
        branch: "httpapi-experimental",
        directory: expect.any(String),
      }),
    )

    expect(HttpApiBridge.supports("/experimental/worktree/reset", "POST")).toBe(true)
    const reset = (await jsonRequest("POST", "/experimental/worktree/reset", directory, {
      directory: created.directory,
    })) as boolean
    expect(reset).toBe(true)

    expect(HttpApiBridge.supports("/experimental/worktree", "DELETE")).toBe(true)
    const removed = (await jsonRequest("DELETE", "/experimental/worktree", directory, {
      directory: created.directory,
    })) as boolean
    expect(removed).toBe(true)
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
