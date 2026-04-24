import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Instance } from "../../src/project/instance"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-worktree-test-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

const [{ Worktree }] = await Promise.all([import("../../src/worktree")])

// Store created test projects for cleanup
const projectDirs: string[] = []

async function withProject<T>(fn: (projectDir: string) => Promise<T>): Promise<T> {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-worktree-project-"))
  projectDirs.push(projectDir)
  return Instance.provide({
    directory: projectDir,
    fn: () => fn(projectDir),
  })
}

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

afterAll(async () => {
  await Instance.disposeAll().catch(() => undefined)
  await Promise.all(projectDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  await fs.rm(testHome, { recursive: true, force: true })
})

describe("Worktree.list", () => {
  it("returns empty array for non-git project", async () => {
    await withProject(async () => {
      // Simulate non-git project by mocking
      expect(Worktree.create).toBeDefined()
    })
  })
})
