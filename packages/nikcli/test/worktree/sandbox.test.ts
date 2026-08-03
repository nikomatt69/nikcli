import { preserveTestEnv } from "../helpers/env"
import { afterAll, afterEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Instance } from "../../src/project/instance"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-sandbox-test-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

preserveTestEnv(["NIKCLI_TEST_HOME", "NIKCLI_DISABLE_PROJECT_CONFIG"])

const [{ RunSandbox }] = await Promise.all([import("../../src/worktree/sandbox")])

const projectDirs: string[] = []

async function git(directory: string, ...args: string[]) {
  const proc = Bun.spawn(["git", ...args], { cwd: directory, stdout: "pipe", stderr: "pipe" })
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr || stdout}`)
  return stdout
}

async function withGitProject<T>(fn: (projectDir: string) => Promise<T>): Promise<T> {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-sandbox-git-project-"))
  projectDirs.push(projectDir)
  await git(projectDir, "init", "-b", "main")
  await fs.writeFile(path.join(projectDir, "README.md"), "# sandbox test\n")
  await git(projectDir, "add", "README.md")
  await git(projectDir, "-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", "initial")
  const resolved = await fs.realpath(projectDir)
  return Instance.provide({ directory: resolved, fn: () => fn(resolved) })
}

async function withPlainProject<T>(fn: (projectDir: string) => Promise<T>): Promise<T> {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-sandbox-plain-project-"))
  projectDirs.push(projectDir)
  const resolved = await fs.realpath(projectDir)
  return Instance.provide({ directory: resolved, fn: () => fn(resolved) })
}

async function exists(target: string) {
  return fs
    .stat(target)
    .then(() => true)
    .catch(() => false)
}

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

afterAll(async () => {
  await Instance.disposeAll().catch(() => undefined)
  await Promise.all(projectDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  await fs.rm(testHome, { recursive: true, force: true })
})

describe("RunSandbox.ensure", () => {
  it("creates the worktree under .nikcli/.worktrees and ignores it from the parent repo", async () => {
    const { withIsolatedDatabase } = await import("../helpers/sqlite")
    await withIsolatedDatabase(async () => {
      await withGitProject(async (projectDir) => {
        const sandbox = await RunSandbox.ensure({
          hostDirectory: projectDir,
          name: "loop-nightly-qa",
          branchPrefix: "nikcli/loop",
        })
        expect(sandbox).toBeDefined()

        const root = path.join(projectDir, RunSandbox.ROOT)
        expect(path.dirname(sandbox!.directory)).toBe(root)
        expect(path.basename(sandbox!.directory)).toBe("worktree-loop-nightly-qa")
        expect(sandbox!.branch).toBe("nikcli/loop/worktree-loop-nightly-qa")
        expect(await exists(path.join(sandbox!.directory, "README.md"))).toBe(true)

        // The self-ignoring root keeps the sandbox out of the host's status.
        expect(await Bun.file(path.join(root, ".gitignore")).text()).toContain("*")
        const status = await git(projectDir, "status", "--porcelain")
        expect(status.trim()).toBe("")
      })
    })
  })

  it("reuses an existing sandbox instead of branching a new one", async () => {
    const { withIsolatedDatabase } = await import("../helpers/sqlite")
    await withIsolatedDatabase(async () => {
      await withGitProject(async (projectDir) => {
        const first = await RunSandbox.ensure({
          hostDirectory: projectDir,
          name: "loop-reuse",
          branchPrefix: "nikcli/loop",
        })
        const second = await RunSandbox.ensure({
          hostDirectory: projectDir,
          name: "loop-reuse",
          branchPrefix: "nikcli/loop",
          existing: first!,
        })
        expect(second).toEqual(first!)
      })
    })
  })

  it("recreates the sandbox when the recorded directory is gone", async () => {
    const { withIsolatedDatabase } = await import("../helpers/sqlite")
    await withIsolatedDatabase(async () => {
      await withGitProject(async (projectDir) => {
        const stale = {
          name: "worktree-loop-stale",
          branch: "nikcli/loop/worktree-loop-stale",
          directory: path.join(projectDir, RunSandbox.ROOT, "worktree-loop-stale"),
        }
        const sandbox = await RunSandbox.ensure({
          hostDirectory: projectDir,
          name: "loop-stale",
          branchPrefix: "nikcli/loop",
          existing: stale,
        })
        expect(sandbox).toBeDefined()
        // The freed name is reclaimed, but it is a real checkout again — not
        // the dangling record we were handed.
        expect(await exists(path.join(sandbox!.directory, ".git"))).toBe(true)
        expect(await exists(path.join(sandbox!.directory, "README.md"))).toBe(true)
      })
    })
  })

  it("returns undefined for a non-git project so the run falls back to the host directory", async () => {
    const { withIsolatedDatabase } = await import("../helpers/sqlite")
    await withIsolatedDatabase(async () => {
      await withPlainProject(async (projectDir) => {
        const sandbox = await RunSandbox.ensure({
          hostDirectory: projectDir,
          name: "loop-plain",
          branchPrefix: "nikcli/loop",
        })
        expect(sandbox).toBeUndefined()
      })
    })
  })
})

describe("RunSandbox.release", () => {
  it("removes a sandbox that holds no work", async () => {
    const { withIsolatedDatabase } = await import("../helpers/sqlite")
    await withIsolatedDatabase(async () => {
      await withGitProject(async (projectDir) => {
        const sandbox = await RunSandbox.ensure({
          hostDirectory: projectDir,
          name: "loop-clean",
          branchPrefix: "nikcli/loop",
        })
        expect(await RunSandbox.release({ hostDirectory: projectDir, sandbox: sandbox! })).toBe(true)
        expect(await exists(sandbox!.directory)).toBe(false)
      })
    })
  })

  it("keeps a sandbox with uncommitted changes", async () => {
    const { withIsolatedDatabase } = await import("../helpers/sqlite")
    await withIsolatedDatabase(async () => {
      await withGitProject(async (projectDir) => {
        const sandbox = await RunSandbox.ensure({
          hostDirectory: projectDir,
          name: "loop-dirty",
          branchPrefix: "nikcli/loop",
        })
        await fs.writeFile(path.join(sandbox!.directory, "README.md"), "# edited by the agent\n")

        expect(await RunSandbox.release({ hostDirectory: projectDir, sandbox: sandbox! })).toBe(false)
        expect(await exists(sandbox!.directory)).toBe(true)
      })
    })
  })

  it("keeps a sandbox that is ahead of the base branch", async () => {
    const { withIsolatedDatabase } = await import("../helpers/sqlite")
    await withIsolatedDatabase(async () => {
      await withGitProject(async (projectDir) => {
        const sandbox = await RunSandbox.ensure({
          hostDirectory: projectDir,
          name: "loop-ahead",
          branchPrefix: "nikcli/loop",
        })
        await fs.writeFile(path.join(sandbox!.directory, "feature.md"), "# shipped\n")
        await git(sandbox!.directory, "add", "feature.md")
        await git(
          sandbox!.directory,
          "-c",
          "user.email=test@example.com",
          "-c",
          "user.name=Test",
          "commit",
          "-m",
          "agent work",
        )

        expect(await RunSandbox.release({ hostDirectory: projectDir, sandbox: sandbox! })).toBe(false)
        expect(await exists(sandbox!.directory)).toBe(true)
      })
    })
  })
})
