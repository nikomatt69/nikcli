import { preserveTestEnv } from "../helpers/env"
import { removeTestDir } from "../helpers/fs"
import { afterAll, afterEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-mobile-github-route-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_TEST_MODE = "1"
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
process.env.XDG_DATA_HOME = path.join(testHome, "data")
process.env.XDG_CACHE_HOME = path.join(testHome, "cache")
process.env.XDG_CONFIG_HOME = path.join(testHome, "config")
process.env.XDG_STATE_HOME = path.join(testHome, "state")

preserveTestEnv([
  "NIKCLI_TEST_HOME",
  "NIKCLI_TEST_MODE",
  "NIKCLI_DISABLE_PROJECT_CONFIG",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
])
for (const dir of ["data", "cache", "config", "state"]) {
  await fs.mkdir(path.join(testHome, dir), { recursive: true })
}

const projectDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-mobile-github-route-project-")))
const { Instance } = await import("@/project/instance")
const { Server } = await import("@/server/server")

const originalFetch = globalThis.fetch
const githubCalls: string[] = []

function request(pathname: string, init?: RequestInit) {
  return Server.fetch(
    new Request(`http://nikcli.local/mobile${pathname}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-nikcli-directory": projectDir,
        ...init?.headers,
      },
    }),
  )
}

afterEach(() => {
  globalThis.fetch = originalFetch
  githubCalls.length = 0
})

afterAll(async () => {
  globalThis.fetch = originalFetch
  await Instance.disposeAll().catch(() => undefined)
  await removeTestDir(testHome)
  await removeTestDir(projectDir)
})

function stubGithubRepos(status: number, body: unknown, statusText = "OK") {
  githubCalls.length = 0
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.includes("api.github.com/user/repos")) {
      githubCalls.push(url)
      return new Response(JSON.stringify(body), {
        status,
        statusText,
        headers: { "content-type": "application/json" },
      })
    }
    return originalFetch(input as Parameters<typeof fetch>[0], init)
  }) as typeof fetch
}

const sampleRepo = {
  id: 1,
  name: "widget",
  full_name: "acme/widget",
  description: null,
  private: false,
  html_url: "https://github.com/acme/widget",
  default_branch: "main",
  updated_at: "2026-01-01T00:00:00Z",
  stargazers_count: 0,
  language: null,
  topics: [],
}

describe("mobile GitHub repo routes", () => {
  it("lists repos without an empty 400 and maps GitHub API failures", async () => {
    const missing = await request("/github/repos")
    expect(missing.status).toBe(401)
    expect(((await missing.json()) as { error: string }).error).toContain("GitHub token not configured")

    const saved = await request("/github/auth", {
      method: "POST",
      body: JSON.stringify({ token: "gho_test_token" }),
    })
    expect(saved.status).toBe(200)

    stubGithubRepos(200, [sampleRepo])
    const listed = await request("/github/repos")
    expect(listed.status).toBe(200)
    const repos = (await listed.json()) as Array<Record<string, unknown>>
    expect(repos).toHaveLength(1)
    expect(repos[0]?.full_name).toBe("acme/widget")
    expect(repos[0]?.imported).toBe(false)
    expect("imported_directory" in (repos[0] ?? {})).toBe(false)
    expect("imported_project_id" in (repos[0] ?? {})).toBe(false)
    expect(githubCalls[0]).toContain("affiliation=")
    expect(githubCalls[0]).not.toContain("type=")

    stubGithubRepos(401, { message: "Bad credentials" }, "Unauthorized")
    const unauthorized = await request("/github/repos")
    expect(unauthorized.status).toBe(401)
    const unauthorizedBody = (await unauthorized.json()) as { name: string; error: string }
    expect(unauthorizedBody.name).toBe("Unauthorized")
    expect(unauthorizedBody.error).toContain("401")

    stubGithubRepos(400, { message: "Problems parsing JSON" }, "Bad Request")
    const bad = await request("/github/repos")
    expect(bad.status).toBe(400)
    const badBody = (await bad.json()) as { name: string; error: string }
    expect(badBody.name).toBe("BadRequest")
    expect(badBody.error).toContain("400")
  })
})
