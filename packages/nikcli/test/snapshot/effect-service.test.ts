import { preserveTestEnv } from "../helpers/env"
import { afterAll, afterEach, describe, expect, it } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Instance } from "../../src/project/instance"
import { runPromiseWithLayer, withCurrentInstance } from "../../src/effect"
import { Global } from "../../src/global"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-snapshot-effect-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

preserveTestEnv(["NIKCLI_TEST_HOME", "NIKCLI_DISABLE_PROJECT_CONFIG"])

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

  it("registers hourly cleanup with a seven-day prune TTL", async () => {
    const source = await fs.readFile(path.resolve(import.meta.dir, "../../src/snapshot/index.ts"), "utf8")
    expect(source).toContain('id: "snapshot.cleanup"')
    expect(source).toContain("interval: hour")
    expect(source).toContain('const prune = "7.days"')
    expect(source).toContain('"gc", `--prune=${prune}`')
  })

  it("prunes unreachable snapshot objects older than seven days", async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-snapshot-git-project-"))
    projectDirs.push(projectDir)
    await Bun.spawn(["git", "init"], {
      cwd: projectDir,
      stdout: "ignore",
      stderr: "ignore",
    }).exited
    await fs.writeFile(path.join(projectDir, "tracked.txt"), "snapshot")

    await Instance.provide({
      directory: projectDir,
      fn: async () => {
        const hash = await runSnapshot(
          Effect.gen(function* () {
            const snapshot = yield* Snapshot.Service
            return yield* snapshot.track()
          }),
        )
        expect(hash).toBeTruthy()
        const snapshotGitDir = path.join(Global.Path.data, "snapshot", Instance.project.id)
        const orphanFile = path.join(projectDir, "orphan.txt")
        await fs.writeFile(orphanFile, "unreachable snapshot object")
        const orphan = Bun.spawn(["git", "--git-dir", snapshotGitDir, "hash-object", "-w", orphanFile], {
          cwd: projectDir,
          stdout: "pipe",
          stderr: "ignore",
        })
        const orphanHash = (await new Response(orphan.stdout).text()).trim()
        expect(await orphan.exited).toBe(0)
        const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
        const objects = path.join(Global.Path.data, "snapshot", Instance.project.id, "objects")
        for (const prefix of await fs.readdir(objects, {
          withFileTypes: true,
        })) {
          if (!prefix.isDirectory() || prefix.name.length !== 2) continue
          const directory = path.join(objects, prefix.name)
          for (const entry of await fs.readdir(directory, {
            withFileTypes: true,
          })) {
            if (entry.isFile()) await fs.utimes(path.join(directory, entry.name), old, old)
          }
        }
        const catFile = () =>
          Bun.spawn(["git", "--git-dir", snapshotGitDir, "cat-file", "-e", orphanHash], {
            cwd: projectDir,
            stdout: "ignore",
            stderr: "ignore",
          }).exited
        expect(await catFile()).toBe(0)

        await runSnapshot(
          Effect.gen(function* () {
            const snapshot = yield* Snapshot.Service
            yield* snapshot.cleanup()
          }),
        )

        expect(await catFile()).not.toBe(0)
      },
    })
  })
})
