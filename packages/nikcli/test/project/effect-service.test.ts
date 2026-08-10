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
      // A directory with no VCS resolves to the filesystem root, matching
      // opencode v2's `path.parse(input).root` fallback for the global project.
      expect(result.created.project.canonical).toBe(path.parse(projectDir).root)
      expect(result.updated.name).toBe("Project Service Test")
      expect(result.listed.map((project) => project.id)).toContain("global")
      expect(result.withSandbox.sandboxes).toEqual([])
      expect(result.sandboxes).toEqual([])
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true })
      await fs.rm(sandboxDir, { recursive: true, force: true })
    }
  })

  it("uses a normalized origin identity and tracks canonical project directories", async () => {
    const sshDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-project-ssh-"))
    const httpsDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-project-https-"))
    const git = async (directory: string, ...args: string[]) => {
      const process = Bun.spawn(["git", ...args], { cwd: directory, stdout: "pipe", stderr: "pipe" })
      const [code, stderr] = await Promise.all([process.exited, new Response(process.stderr).text()])
      if (code !== 0) throw new Error(stderr)
    }

    try {
      await Promise.all(
        [
          [sshDir, "git@github.com:Acme/App.git"],
          [httpsDir, "https://github.com/Acme/App.git"],
        ].map(async ([directory, remote]) => {
          await git(directory, "init")
          await git(
            directory,
            "-c",
            "user.email=test@example.com",
            "-c",
            "user.name=Test",
            "commit",
            "--allow-empty",
            "-m",
            "root",
          )
          await git(directory, "remote", "add", "origin", remote)
        }),
      )

      const [ssh, https] = await Promise.all([
        runProject(
          Effect.gen(function* () {
            return yield* (yield* Project.Service).fromDirectory(sshDir)
          }),
        ),
        runProject(
          Effect.gen(function* () {
            return yield* (yield* Project.Service).fromDirectory(httpsDir)
          }),
        ),
      ])
      expect(ssh.project.id).toBe(https.project.id)
      expect(ssh.project.id).not.toBe("global")
      expect(
        await runProject(
          Effect.gen(function* () {
            return yield* (yield* Project.Service).directories(ssh.project.id)
          }),
        ),
      ).toEqual(
        expect.arrayContaining([{ directory: await fs.realpath(sshDir) }, { directory: await fs.realpath(httpsDir) }]),
      )
    } finally {
      await Promise.all([sshDir, httpsDir].map((directory) => fs.rm(directory, { recursive: true, force: true })))
    }
  })
})

afterAll(async () => {
  await fs.rm(testHome, { recursive: true, force: true })
})
