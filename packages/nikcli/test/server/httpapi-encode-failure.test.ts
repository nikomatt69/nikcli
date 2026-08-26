import type { Session } from "@/session"
import { preserveTestEnv } from "../helpers/env"
import { removeTestDir } from "../helpers/fs"
import { afterAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-encode-home-"))
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

const { Instance } = await import("@/project/instance")
const { Server } = await import("@/server/server")
const { SessionRepo } = await import("@/session/repo")
const { Log } = await import("@nikcli-ai/util/log")

const projectDirs: string[] = []

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-encode-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

function captureEffectLog() {
  const logger = Log.create({ service: "effect" })
  const lines: string[] = []
  const original = logger.error
  logger.error = (message?: any, extra?: Record<string, any>) => {
    lines.push(String(message))
    return original.call(logger, message, extra)
  }
  return {
    lines,
    restore: () => {
      logger.error = original
    },
  }
}

afterAll(async () => {
  for (const dir of projectDirs) await removeTestDir(dir)
  await removeTestDir(testHome)
})

/**
 * E6 / beta.105: Schema issues no longer format through `Issue#toString`.
 * `logFailures` exists because two encode failures once answered an empty 400
 * with nothing logged. Pin the field name and expected type so that silence
 * cannot come back with the pin bump.
 */
describe("encoded-route failure log", () => {
  it("names the offending field and expected type when encode rejects workspaceID: null", async () => {
    const directory = await makeProjectDir()
    const created = (await (
      await Server.fetch(
        new Request(new URL("/session?directory=" + encodeURIComponent(directory), "http://nikcli.local"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
      )
    ).json()) as Session.Info

    await Instance.provide({
      directory,
      fn: async () => {
        const info = SessionRepo.get(created.id)
        if (!info) throw new Error(`session ${created.id} missing after create`)
        SessionRepo.upsert({ ...info, workspaceID: null } as unknown as Session.Info)
      },
    })

    const capture = captureEffectLog()
    try {
      const response = await Server.fetch(
        new Request(
          new URL(`/session/${created.id}?directory=${encodeURIComponent(directory)}`, "http://nikcli.local"),
        ),
      )
      expect(response.status).toBe(400)
      expect(await response.text()).toBe("")

      const logged = capture.lines.join("\n")
      expect(logged).toContain("encoded route failed")
      expect(logged).toContain("workspaceID")
      expect(logged).toMatch(/string/i)
      // beta.105 dropped implicit `Issue#toString` "got null"; the RC formatter
      // still names the expected type and the path. Pin both so a silent 400
      // cannot return.
      expect(logged).toContain("Expected string")
      expect(logged).toContain('["workspaceID"]')
    } finally {
      capture.restore()
    }
  })
})
