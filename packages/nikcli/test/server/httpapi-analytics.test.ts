import { preserveTestEnv } from "../helpers/env"
import { removeTestDir } from "../helpers/fs"
import { afterAll, afterEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-analytics-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
process.env.NIKCLI_EXPERIMENTAL_HTTPAPI = "1"

preserveTestEnv(["NIKCLI_TEST_HOME", "NIKCLI_DISABLE_PROJECT_CONFIG", "NIKCLI_EXPERIMENTAL_HTTPAPI"])

const { Instance } = await import("@/project/instance")
const { HttpApiBridge } = await import("@/server/httpapi/bridge")
const { Server } = await import("@/server/server")

const projectDirs: string[] = []

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-analytics-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

async function request(pathname: string, directory: string) {
  const url = new URL(pathname, "http://nikcli.local")
  url.searchParams.set("directory", directory)
  return Server.App().fetch(new Request(url))
}

describe("Analytics HttpApi", () => {
  it("advertises analytics routes as supported HttpApi paths", () => {
    expect(HttpApiBridge.supports("/analytics/global", "GET")).toBe(true)
    expect(HttpApiBridge.supports("/analytics/daily", "GET")).toBe(true)
    expect(HttpApiBridge.supports("/analytics/session/ses_123", "GET")).toBe(true)
    expect(HttpApiBridge.supports("/analytics/sessions", "GET")).toBe(true)
    expect(HttpApiBridge.supports("/analytics/leaderboard", "GET")).toBe(true)
    expect(HttpApiBridge.supports("/analytics/global", "POST")).toBe(false)
  })

  it("serves GET /analytics/global via HttpApi", async () => {
    const directory = await makeProjectDir()
    const response = await request("/analytics/global", directory)
    expect(response.status).toBe(200)

    const body = (await response.json()) as {
      totals: unknown
      byModel: Record<string, unknown>
      byProvider: Record<string, unknown>
      byProject: Record<string, unknown>
    }
    expect(body).toBeTruthy()
    expect(typeof body.byModel).toBe("object")
    expect(typeof body.byProvider).toBe("object")
  })

  it("serves GET /analytics/daily with default range", async () => {
    const directory = await makeProjectDir()
    const response = await request("/analytics/daily", directory)
    expect(response.status).toBe(200)
    expect(Array.isArray(await response.json())).toBe(true)
  })

  it("serves GET /analytics/daily with explicit days query", async () => {
    const directory = await makeProjectDir()
    const response = await request("/analytics/daily?days=7", directory)
    expect(response.status).toBe(200)
    expect(Array.isArray(await response.json())).toBe(true)
  })

  it("returns the legacy 404 body for a missing session", async () => {
    const directory = await makeProjectDir()
    const response = await request("/analytics/session/ses_does_not_exist", directory)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "Session not found" })
  })

  it("serves GET /analytics/sessions via HttpApi", async () => {
    const directory = await makeProjectDir()
    const response = await request("/analytics/sessions", directory)
    expect(response.status).toBe(200)
    expect(Array.isArray(await response.json())).toBe(true)
  })

  it("serves GET /analytics/leaderboard via HttpApi", async () => {
    const directory = await makeProjectDir()
    const response = await request("/analytics/leaderboard", directory)
    expect(response.status).toBe(200)

    const body = (await response.json()) as {
      models: unknown[]
      providers: unknown[]
      projects: unknown[]
    }
    expect(Array.isArray(body.models)).toBe(true)
    expect(Array.isArray(body.providers)).toBe(true)
    expect(Array.isArray(body.projects)).toBe(true)
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
