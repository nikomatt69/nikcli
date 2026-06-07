import { afterAll, afterEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Instance } from "../../src/project/instance"
import { runPromiseWithLayer, withCurrentInstance } from "../../src/effect"
import { Effect } from "effect"

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

async function git(directory: string, ...args: string[]) {
  const proc = Bun.spawn(["git", ...args], { cwd: directory, stdout: "pipe", stderr: "pipe" })
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr || stdout}`)
}

async function withGitProject<T>(fn: (projectDir: string) => Promise<T>): Promise<T> {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-worktree-git-project-"))
  projectDirs.push(projectDir)
  await git(projectDir, "init")
  await fs.writeFile(path.join(projectDir, "README.md"), "# worktree test\n")
  await git(projectDir, "add", "README.md")
  await git(projectDir, "-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", "initial")
  return Instance.provide({
    directory: projectDir,
    fn: () => fn(projectDir),
  })
}

function runWorktree<A, E>(effect: Effect.Effect<A, E, any>) {
  return runPromiseWithLayer(Worktree.defaultLayer, withCurrentInstance(effect))
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
      const result = await runWorktree(
        Effect.gen(function* () {
          const worktree = yield* Worktree.Service
          return yield* worktree.list()
        }),
      )
      expect(result).toEqual([])
    })
  })

  it("creates a detached worktree from precomputed info and omits the primary worktree", async () => {
    await withGitProject(async (projectDir) => {
      const info = await runWorktree(
        Effect.gen(function* () {
          const worktree = yield* Worktree.Service
          const next = yield* worktree.makeWorktreeInfo({ name: "Detached Feature", detached: true })
          yield* worktree.createFromInfo(next)
          return next
        }),
      )

      expect(info.name).toBe("detached-feature")
      expect(info.branch).toBeUndefined()

      const result = await runWorktree(
        Effect.gen(function* () {
          const worktree = yield* Worktree.Service
          return yield* worktree.list()
        }),
      )
      expect(result).toContainEqual({ ...info, directory: await fs.realpath(info.directory) })
      expect(result.some((item) => path.resolve(item.directory) === path.resolve(projectDir))).toBe(false)

      await runWorktree(
        Effect.gen(function* () {
          const worktree = yield* Worktree.Service
          yield* worktree.remove({ directory: info.directory })
        }),
      )
    })
  })
})

describe("Worktree safety", () => {
  it("detects directories inside the managed worktree root", () => {
    const root = path.join(testHome, "managed")

    expect(Worktree.isManagedDirectory(path.join(root, "feature"), root)).toBe(true)
    expect(Worktree.isManagedDirectory(root, root)).toBe(false)
    expect(Worktree.isManagedDirectory(path.join(testHome, "outside"), root)).toBe(false)
  })
})
