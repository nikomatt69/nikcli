import { preserveTestEnv } from "../helpers/env"
import { removeTestDir } from "../helpers/fs"
import { afterAll, describe, expect, it, mock } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-instance-cache-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

preserveTestEnv(["NIKCLI_TEST_HOME", "NIKCLI_DISABLE_PROJECT_CONFIG"])

// `socketPathFor` derives the daemon socket from a directory; the real one
// walks up looking for a workspace root and the real `ensureDaemon` spawns a
// process. Neither is what this file is about — it is about which directory
// the caller passes.
const socketCalls: (string | undefined)[] = []
const shutdowns: string[] = []
mock.module("@nikcli-ai/browser-control", () => ({
  socketPathFor: async (directory?: string) => {
    socketCalls.push(directory)
    return `${directory ?? "<cwd>"}/.sock`
  },
  ensureDaemon: async () => undefined,
  rpc: async () => undefined,
  shutdownDaemon: async (socket: string) => {
    shutdowns.push(socket)
  },
}))

const [{ Instance }, { BackgroundRun }, { BackgroundRunRepo }, { BrowserControl }] = await Promise.all([
  import("@/project/instance"),
  import("@/background/run"),
  import("@/background/repo"),
  import("@/browser-control/browser-control"),
])

const created: string[] = []

async function project<T>(label: string, fn: (directory: string) => Promise<T>): Promise<T> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), `nikcli-instance-cache-${label}-`))
  created.push(directory)
  // A git repository with a commit, because the project id is derived from the
  // root commit and every directory without one falls back to the shared id
  // `global`. Two plain temp dirs are a single project, and a test built on
  // them would pass whatever the cache did.
  // The file makes the root commit unique. Two empty commits written in the
  // same second by the same author hash identically, which would hand both
  // directories the same project id and quietly defeat the test.
  await fs.writeFile(path.join(directory, "marker"), `${label} ${directory}`)
  await Bun.$`git init -q && git add -A && git commit -q -m init`
    .cwd(directory)
    .env({
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    })
    .quiet()
  return Instance.provide({ directory, fn: () => fn(directory) })
}

function record(id: string, parentSessionID: string) {
  return {
    id,
    parentSessionID,
    agent: "explore",
    prompt: "p",
    status: "running" as const,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    artifactPath: `/tmp/${id}.md`,
    title: id,
    ownerID: "owner",
    heartbeatAt: 1_700_000_000_000,
  }
}

afterAll(async () => {
  await Instance.disposeAll()
  for (const dir of created) await removeTestDir(dir)
  await removeTestDir(testHome)
})

/**
 * State that is derived from the ambient instance but stored at module scope.
 *
 * This is the defect class AsyncLocalStorage scoping makes invisible: nothing
 * in a module-level `let` says which directory filled it, so the first
 * instance to arrive answers for every instance after it. One process drives
 * many instances — the server manages a worktree per session — so these are
 * production shapes, not test-only ones.
 */
describe("instance-derived module state", () => {
  it("does not serve one project's background runs to another", async () => {
    const parent = "ses_shared_parent"

    const mine = await project("bg-a", async () => {
      BackgroundRunRepo.upsert(Instance.project.id, record("run-a", parent))
      return BackgroundRun.listForParent(parent)
    })
    expect(mine.map((r) => r.id)).toEqual(["run-a"])

    // A different directory is a different project, and it owns no runs.
    const theirs = await project("bg-b", async () => BackgroundRun.listForParent(parent))
    expect(theirs).toEqual([])
  })

  it("resolves the browser-control socket per instance", async () => {
    const first = await project("browser-a", async () => BrowserControl.daemon())
    const second = await project("browser-b", async () => BrowserControl.daemon())

    expect(second).not.toBe(first)
    expect(socketCalls.length).toBe(2)
  })

  it("shuts every resolved daemon down from outside an instance scope", async () => {
    const a = await project("shutdown-a", async () => BrowserControl.daemon())
    const b = await project("shutdown-b", async () => BrowserControl.daemon())
    shutdowns.length = 0

    // No instance scope: both shutdown callers — the worker's `shutdown` RPC
    // and `serve`'s signal handler — are in this position.
    await BrowserControl.closeAll()

    // Every daemon this process resolved, each closed once. Earlier tests in
    // this file resolved sockets too, so this is a containment check, not an
    // equality one — what matters is that nothing is missed and nothing is
    // shut down twice.
    expect(shutdowns).toContain(a)
    expect(shutdowns).toContain(b)
    expect(shutdowns).toContain("<cwd>/.sock")
    expect(shutdowns.length).toBe(new Set(shutdowns).size)
  })
})
