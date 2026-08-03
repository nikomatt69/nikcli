import { preserveTestEnv } from "../helpers/env"
import { afterAll, beforeEach, describe, expect, it } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-project-effect-home-"))
process.env.NIKCLI_TEST_HOME = testHome

preserveTestEnv(["NIKCLI_TEST_HOME"])

const { Project } = await import("@/project/project")

function runProject<A, E>(effect: Effect.Effect<A, E, any>) {
  return Effect.runPromise(effect.pipe(Effect.provide(Project.defaultLayer)) as Effect.Effect<A, E, never>)
}

describe("Project.Service", () => {
  beforeEach(async () => {
    await fs.rm(path.join(testHome, "data", "storage"), { recursive: true, force: true })
  })

  it("creates, lists, updates, and removes project sandboxes through the Effect service boundary", async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-project-effect-project-"))
    const sandboxDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-project-effect-sandbox-"))

    try {
      const result = await runProject(
        Effect.gen(function* () {
          const project = yield* Project.Service
          const created = yield* project.fromDirectory(projectDir)
          const updated = yield* project.update({
            projectID: created.project.id,
            name: "Project Service Test",
          })
          const listed = yield* project.list()
          const withSandbox = yield* project.removeSandbox(created.project.id, sandboxDir)
          const sandboxes = yield* project.sandboxes(created.project.id)

          return { created, updated, listed, withSandbox, sandboxes }
        }),
      )

      expect(result.created.project.id).toBe("global")
      expect(result.updated.name).toBe("Project Service Test")
      expect(result.listed.map((project) => project.id)).toContain("global")
      expect(result.withSandbox.sandboxes).toEqual([])
      expect(result.sandboxes).toEqual([])
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true })
      await fs.rm(sandboxDir, { recursive: true, force: true })
    }
  })
})

afterAll(async () => {
  await fs.rm(testHome, { recursive: true, force: true })
})
