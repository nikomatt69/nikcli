import { afterAll, afterEach, describe, expect, it } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { runPromiseWithLayer, withCurrentInstance } from "../../src/effect"
import { Instance } from "../../src/project/instance"
import { rmrf } from "../helpers/rmrf"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-summary-effect-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

const { SessionSummary } = await import("../../src/session/summary")

const projectDirs: string[] = []

async function withProject<T>(fn: (projectDir: string) => Promise<T>): Promise<T> {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-summary-project-"))
  const resolved = await fs.realpath(projectDir)
  projectDirs.push(resolved)
  return Instance.provide({
    directory: resolved,
    fn: () => fn(resolved),
  })
}

function runSummary<A, E>(effect: Effect.Effect<A, E, any>) {
  return runPromiseWithLayer(SessionSummary.defaultLayer, withCurrentInstance(effect))
}

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

afterAll(async () => {
  await Instance.disposeAll().catch(() => undefined)
  await Promise.all(projectDirs.map((dir) => rmrf(dir)))
  await rmrf(testHome)
})

describe("SessionSummary.Service", () => {
  it("computes an empty diff when messages do not carry snapshots", async () => {
    await withProject(async () => {
      const result = await runSummary(
        Effect.gen(function* () {
          const summary = yield* SessionSummary.Service
          return yield* summary.computeDiff({ messages: [] })
        }),
      )

      expect(result).toEqual([])
    })
  })
})
