import { afterAll, afterEach, describe, expect, it } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Instance } from "../../src/project/instance"
import { runPromiseWithLayer, withCurrentInstance } from "../../src/effect"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-snapshot-effect-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

const { Snapshot } = await import("../../src/snapshot")

const projectDirs: string[] = []

async function withProject<T>(fn: (projectDir: string) => Promise<T>): Promise<T> {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-snapshot-project-"))
  projectDirs.push(projectDir)
  return Instance.provide({
    directory: projectDir,
    fn: () => fn(projectDir),
  })
}

function runSnapshot<A, E>(effect: Effect.Effect<A, E, any>) {
  return runPromiseWithLayer(Snapshot.defaultLayer, withCurrentInstance(effect))
}

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

afterAll(async () => {
  await Instance.disposeAll().catch(() => undefined)
  await Promise.all(projectDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  await fs.rm(testHome, { recursive: true, force: true })
})

describe("Snapshot.Service", () => {
  it("uses the Effect instance context and no-ops for non-git projects", async () => {
    await withProject(async () => {
      const result = await runSnapshot(
        Effect.gen(function* () {
          const snapshot = yield* Snapshot.Service
          yield* snapshot.init()
          yield* snapshot.cleanup()
          return yield* snapshot.track()
        }),
      )

      expect(result).toBeUndefined()
    })
  })
})
