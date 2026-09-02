import { preserveTestEnv } from "../helpers/env"
import { afterAll, afterEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-delegation-timeout-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

preserveTestEnv(["NIKCLI_TEST_HOME", "NIKCLI_DISABLE_PROJECT_CONFIG"])

const [{ Instance }, { Delegation }, { BackgroundRun }] = await Promise.all([
  import("../../src/project/instance"),
  import("../../src/delegation/manager"),
  import("../../src/background/run"),
])

const projectDirs: string[] = []

async function withProject<T>(fn: () => Promise<T>): Promise<T> {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-delegation-timeout-project-"))
  projectDirs.push(projectDir)
  return Instance.provide({ directory: projectDir, fn })
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function uniqueSessionID(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/** Poll rather than sleep a fixed span: the forced finalize lands ~1s after the watchdog fires. */
async function waitForStatus(delegationID: string, status: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const record = await BackgroundRun.get(delegationID).catch(() => undefined)
    if (record?.status === status) return record
    await sleep(50)
  }
  return await BackgroundRun.get(delegationID).catch(() => undefined)
}

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

afterAll(async () => {
  await Instance.disposeAll().catch(() => undefined)
  const { Database } = await import("../../src/database/database")
  Database.closeAll()
  await Promise.all(projectDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  await fs.rm(testHome, { recursive: true, force: true })
})

const TEST_TIMEOUT_MS = 30_000

describe("delegation timeout policy", () => {
  it(
    "expires a silent delegation once the floor has passed",
    async () => {
      await withProject(async () => {
        const record = await Delegation.create({
          parentSessionID: uniqueSessionID("ses_idle"),
          agent: "explore",
          prompt: "Never reports progress",
          source: "task",
          timeout: { minMs: 300, idleMs: 200, maxMs: 20_000 },
        })

        const settled = await waitForStatus(record.id, "timeout", 8_000)
        expect(settled?.status).toBe("timeout")
        expect(settled?.error).toContain("no output for")
      })
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "keeps a delegation that is still producing output alive past the floor",
    async () => {
      await withProject(async () => {
        const record = await Delegation.create({
          parentSessionID: uniqueSessionID("ses_active"),
          agent: "explore",
          prompt: "Reports progress continuously",
          source: "task",
          timeout: { minMs: 200, idleMs: 400, maxMs: 20_000 },
        })

        // Well past `min` — a fixed deadline would have killed this already.
        const until = Date.now() + 1_500
        while (Date.now() < until) {
          Delegation.touch(record.id)
          await sleep(50)
        }
        expect((await BackgroundRun.get(record.id))?.status).toBe("running")

        // Stop producing: the same delegation now reads as stuck.
        const settled = await waitForStatus(record.id, "timeout", 8_000)
        expect(settled?.status).toBe("timeout")
      })
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "expires an active delegation at the hard cap",
    async () => {
      await withProject(async () => {
        const record = await Delegation.create({
          parentSessionID: uniqueSessionID("ses_cap"),
          agent: "explore",
          prompt: "Busy forever",
          source: "task",
          timeout: { minMs: 100, idleMs: 60_000, maxMs: 800 },
        })

        const ticker = setInterval(() => Delegation.touch(record.id), 50)
        try {
          const settled = await waitForStatus(record.id, "timeout", 8_000)
          expect(settled?.status).toBe("timeout")
          expect(settled?.error).toContain("hard cap")
        } finally {
          clearInterval(ticker)
        }
      })
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "leaves a finalized delegation alone",
    async () => {
      await withProject(async () => {
        const record = await Delegation.create({
          parentSessionID: uniqueSessionID("ses_done"),
          agent: "explore",
          prompt: "Finishes immediately",
          source: "task",
          timeout: { minMs: 200, idleMs: 200, maxMs: 500 },
        })
        await Delegation.finalize(record.id, "complete", "done")

        await sleep(1_500)
        const settled = await BackgroundRun.get(record.id)
        expect(settled?.status).toBe("complete")
      })
    },
    TEST_TIMEOUT_MS,
  )
})
