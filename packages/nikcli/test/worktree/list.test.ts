import { preserveTestEnv } from "../helpers/env"
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

preserveTestEnv(["NIKCLI_TEST_HOME", "NIKCLI_DISABLE_PROJECT_CONFIG"])

const [{ Worktree }, { ProjectCopy }, { Project }] = await Promise.all([
  import("../../src/worktree"),
  import("../../src/project/copy"),
  import("../../src/project/project"),
])

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

function runProjectCopy<A, E>(effect: Effect.Effect<A, E, any>) {
  return runPromiseWithLayer(ProjectCopy.defaultLayer, withCurrentInstance(effect))
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
    // Per-case isolation: even though the file sets NIKCLI_TEST_HOME once,
    // wrap SQLite-touching worktree ops so concurrent suites cannot share rows.
    const { withIsolatedDatabase } = await import("../helpers/sqlite")
    await withIsolatedDatabase(async () => {
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
  })

  it("creates a detached worktree from precomputed info and omits the primary worktree", async () => {
    const { withIsolatedDatabase } = await import("../helpers/sqlite")
    await withIsolatedDatabase(async () => {
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
})

describe("Worktree safety", () => {
  it("detects directories inside the managed worktree root", () => {
    const root = path.join(testHome, "managed")

    expect(Worktree.isManagedDirectory(path.join(root, "feature"), root)).toBe(true)
    expect(Worktree.isManagedDirectory(root, root)).toBe(false)
    expect(Worktree.isManagedDirectory(path.join(testHome, "outside"), root)).toBe(false)
  })
})

describe("ProjectCopy v2 compatibility", () => {
  it("tracks detached copies and requires force before deleting dirty worktrees", async () => {
    const { withIsolatedDatabase } = await import("../helpers/sqlite")
    await withIsolatedDatabase(async () => {
      await withGitProject(async (projectDir) => {
        const copyRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-project-copy-root-"))
        projectDirs.push(copyRoot)
        const result = await runProjectCopy(
          Effect.gen(function* () {
            const copies = yield* ProjectCopy.Service
            const project = yield* Project.Service
            const current = yield* project.fromDirectory(projectDir)
            const copy = yield* copies.create({
              projectID: current.project.id,
              strategy: "git_worktree",
              sourceDirectory: projectDir,
              directory: copyRoot,
              name: "v2-copy",
            })
            const directories = yield* project.directories(current.project.id)
            return { copies, project, current, copy, directories }
          }),
        )

        expect(result.directories).toContainEqual({
          directory: await fs.realpath(result.copy.directory),
          strategy: "git_worktree",
        })
        expect(await gitBranch(result.copy.directory)).toBe("HEAD")

        await fs.writeFile(path.join(result.copy.directory, "dirty.txt"), "dirty\n")
        const error = await runProjectCopy(
          Effect.gen(function* () {
            const copies = yield* ProjectCopy.Service
            return yield* copies.remove({
              projectID: result.current.project.id,
              directory: result.copy.directory,
              force: false,
            })
          }),
        ).catch((cause) => cause)
        expect(error).toMatchObject({ _tag: "ProjectCopyError", forceRequired: true })

        await runProjectCopy(
          Effect.gen(function* () {
            const copies = yield* ProjectCopy.Service
            yield* copies.remove({
              projectID: result.current.project.id,
              directory: result.copy.directory,
              force: true,
            })
          }),
        )
        expect(await fs.stat(result.copy.directory).catch(() => undefined)).toBeUndefined()
      })
    })
  })

  it("tags the main worktree apart from linked ones", async () => {
    await withGitProject(async (projectDir) => {
      const entries = await runWorktree(
        Effect.gen(function* () {
          const worktree = yield* Worktree.Service
          const info = yield* worktree.makeWorktreeInfo({ name: "linked-copy" })
          yield* worktree.createFromInfo(info)
          return yield* worktree.listEntries()
        }),
      )

      const main = entries.filter((entry) => entry.kind === "main")
      expect(main).toHaveLength(1)
      expect(main[0]?.directory).toBe(await fs.realpath(projectDir))
      expect(entries.filter((entry) => entry.kind === "linked").map((entry) => entry.branch)).toEqual([
        "nikcli/linked-copy",
      ])
    })
  })

  it("escalates the copy name when the destination is taken", async () => {
    const { withIsolatedDatabase } = await import("../helpers/sqlite")
    await withIsolatedDatabase(async () => {
      await withGitProject(async (projectDir) => {
        const copyRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-project-copy-suffix-"))
        projectDirs.push(copyRoot)
        // Occupy `taken`, so the copy has to become `taken-2`.
        await fs.mkdir(path.join(copyRoot, "taken"))

        const copy = await runProjectCopy(
          Effect.gen(function* () {
            const copies = yield* ProjectCopy.Service
            const project = yield* Project.Service
            const current = yield* project.fromDirectory(projectDir)
            return yield* copies.create({
              projectID: current.project.id,
              strategy: "git_worktree",
              sourceDirectory: projectDir,
              directory: copyRoot,
              name: "taken",
            })
          }),
        )

        expect(path.basename(copy.directory)).toBe("taken-2")
      })
    })
  })

  it("refresh discovers an external worktree and prunes a vanished directory", async () => {
    const { withIsolatedDatabase } = await import("../helpers/sqlite")
    await withIsolatedDatabase(async () => {
      await withGitProject(async (projectDir) => {
        const external = path.join(await fs.realpath(os.tmpdir()), `nikcli-external-${Date.now()}`)
        projectDirs.push(external)
        await git(projectDir, "worktree", "add", "--detach", external, "HEAD")
        const vanished = path.join(await fs.realpath(os.tmpdir()), `nikcli-vanished-${Date.now()}`)

        const first = await runProjectCopy(
          Effect.gen(function* () {
            const copies = yield* ProjectCopy.Service
            const project = yield* Project.Service
            const current = yield* project.fromDirectory(projectDir)
            // A tracked directory that no longer exists must be pruned.
            yield* project.trackDirectory(current.project.id, vanished, "git_worktree")
            const result = yield* copies.refresh({ projectID: current.project.id })
            return { projectID: current.project.id, result, project, copies }
          }),
        )

        expect(first.result.updated).toContain(external)
        expect(first.result.removed).toContain(vanished)

        // Removing it in git makes the next refresh prune it.
        await git(projectDir, "worktree", "remove", "--force", external)
        const second = await runProjectCopy(
          Effect.gen(function* () {
            const copies = yield* ProjectCopy.Service
            return yield* copies.refresh({ projectID: first.projectID })
          }),
        )

        expect(second.removed).toContain(external)
        expect(second.updated).not.toContain(external)
      })
    })
  })

  it("applies opencode v2 replace semantics when tracking directories", async () => {
    const { withIsolatedDatabase } = await import("../helpers/sqlite")
    await withIsolatedDatabase(async () => {
      await withGitProject(async (projectDir) => {
        const tracked = await fs.realpath(projectDir)
        const flags = await runProjectCopy(
          Effect.gen(function* () {
            const project = yield* Project.Service
            const current = yield* project.fromDirectory(projectDir)
            const id = current.project.id
            return {
              // Already tracked as a root by `fromDirectory`, so an ignoring
              // create is a no-op even though it carries a strategy.
              ignored: yield* project.trackDirectory(id, tracked, "git_worktree"),
              set: yield* project.trackDirectory(id, tracked, "new/strategy", "replace"),
              same: yield* project.trackDirectory(id, tracked, "new/strategy", "replace"),
              cleared: yield* project.trackDirectory(id, tracked, undefined, "replace"),
              clearedAgain: yield* project.trackDirectory(id, tracked, undefined, "replace"),
            }
          }),
        )

        expect(flags).toEqual({
          ignored: false,
          set: true,
          same: false,
          cleared: true,
          clearedAgain: false,
        })
      })
    })
  })
})

async function gitBranch(directory: string) {
  const proc = Bun.spawn(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: directory,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exitCode, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()])
  if (exitCode !== 0) throw new Error("failed to read worktree branch")
  return stdout.trim()
}
