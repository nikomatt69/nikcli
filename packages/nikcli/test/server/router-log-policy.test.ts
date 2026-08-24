import { preserveTestEnv } from "../helpers/env"
import { removeTestDir } from "../helpers/fs"
import { afterAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-router-log-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
process.env.XDG_DATA_HOME = path.join(testHome, "data")
process.env.XDG_CACHE_HOME = path.join(testHome, "cache")
process.env.XDG_CONFIG_HOME = path.join(testHome, "config")
process.env.XDG_STATE_HOME = path.join(testHome, "state")

preserveTestEnv([
  "NIKCLI_TEST_HOME",
  "NIKCLI_DISABLE_PROJECT_CONFIG",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
])

const { Server } = await import("@/server/server")
const { Log } = await import("@nikcli-ai/util/log")

const projectDirs: string[] = []

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-router-log-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

/**
 * `Log.create` caches one logger per service name, so asking for the router's
 * service hands back the very instance `server-router.ts` writes through.
 */
function captureRouterLog() {
  const logger = Log.create({ service: "server.router" })
  const lines: { message: string; extra?: Record<string, any> }[] = []
  const original = logger.info
  logger.info = (message?: any, extra?: Record<string, any>) => {
    lines.push({ message: String(message), ...(extra ? { extra } : {}) })
    return original.call(logger, message, extra)
  }
  return {
    lines,
    restore: () => {
      logger.info = original
    },
  }
}

async function fetchPath(pathname: string, directory: string, method = "GET") {
  const url = new URL(pathname, "http://nikcli.local")
  url.searchParams.set("directory", directory)
  return Server.fetch(new Request(url, { method, headers: { "x-nikcli-directory": directory } }))
}

afterAll(async () => {
  for (const dir of projectDirs) await removeTestDir(dir)
  await removeTestDir(testHome)
})

/**
 * P2.2: hot polls dominated the request log with no sampling or duration gate.
 * The policy is deterministic — it can only ever suppress a fast, successful
 * poll — so these cases pin both halves: the noise goes, the evidence stays.
 */
describe("router request-log policy", () => {
  it("keeps a fast, successful hot poll out of the log", async () => {
    const directory = await makeProjectDir()
    // Warm the path first; the assertion is about steady-state polling.
    await fetchPath("/session/status", directory)

    const capture = captureRouterLog()
    try {
      const response = await fetchPath("/session/status", directory)
      expect(response.status).toBe(200)
    } finally {
      capture.restore()
    }

    const paths = capture.lines.map((line) => line.extra?.["path"])
    expect(paths).not.toContain("/session/status")
  })

  it("logs an ordinary route both on start and on completion", async () => {
    const directory = await makeProjectDir()
    await fetchPath("/session", directory)

    const capture = captureRouterLog()
    try {
      const response = await fetchPath("/session", directory)
      expect(response.status).toBe(200)
    } finally {
      capture.restore()
    }

    const listed = capture.lines.filter((line) => line.extra?.["path"] === "/session")
    expect(listed.map((line) => line.message)).toEqual(["request", "request completed"])
  })

  it("logs a hot path when it fails, so the policy cannot hide an error", async () => {
    const directory = await makeProjectDir()
    await fetchPath("/session/status", directory)

    const capture = captureRouterLog()
    let status: number
    try {
      const response = await fetchPath("/session/status", directory, "POST")
      status = response.status
    } finally {
      capture.restore()
    }

    expect(status).toBeGreaterThanOrEqual(400)
    const failed = capture.lines.filter((line) => line.extra?.["path"] === "/session/status")
    expect(failed.map((line) => line.message)).toEqual(["request completed"])
  })
})
