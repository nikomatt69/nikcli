import { afterAll, afterEach, describe, expect, it } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-effect-instance-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
process.env.XDG_DATA_HOME = path.join(testHome, "data")
process.env.XDG_CACHE_HOME = path.join(testHome, "cache")
process.env.XDG_CONFIG_HOME = path.join(testHome, "config")
process.env.XDG_STATE_HOME = path.join(testHome, "state")

const { InstanceRef, InstanceScope, InstanceState, WorkspaceRef } = await import("@/effect")
const { Instance } = await import("@/project/instance")

const projectDirs: string[] = []

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-effect-instance-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

describe("InstanceScope", () => {
  it("provides InstanceRef and InstanceState context inside an Effect boundary", async () => {
    const directory = await makeProjectDir()
    const result = await Effect.runPromise(
      InstanceScope.with(
        { directory },
        Effect.gen(function* () {
          const ref = yield* InstanceRef
          const ctx = yield* InstanceState.context
          return {
            refDirectory: ref.directory,
            ctxDirectory: ctx.directory,
            projectID: ctx.project.id,
          }
        }),
      ),
    )

    expect(result.refDirectory).toBe(directory)
    expect(result.ctxDirectory).toBe(directory)
    expect(result.projectID).toBe("global")
  })

  it("provides WorkspaceRef when workspaceID is present", async () => {
    const directory = await makeProjectDir()
    const workspace = await Effect.runPromise(
      InstanceScope.with(
        { directory, workspaceID: "workspace-test" },
        Effect.gen(function* () {
          return yield* WorkspaceRef
        }),
      ),
    )

    expect(workspace.id).toBe("workspace-test")
  })
})

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

afterAll(async () => {
  await Instance.disposeAll().catch(() => undefined)
  await Promise.all(projectDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  await fs.rm(testHome, { recursive: true, force: true })
})
