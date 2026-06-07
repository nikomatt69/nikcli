import { describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

// Regression test for the default (hono) warp route. The TUI talks to this
// route (HttpApi bridge is off by default), and two bugs made warp fail:
//   1. `POST /warp` was registered after `POST /:id`, so it matched the create
//      route as id="warp" and 400'd ("must start with wrk").
//   2. The `id` validator used z.union([wrkString, null]) which rejected null,
//      breaking detach-to-local.
const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-warp-route-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_TEST_MODE = "1"
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
process.env.XDG_DATA_HOME = path.join(testHome, "data")
process.env.XDG_CACHE_HOME = path.join(testHome, "cache")
process.env.XDG_CONFIG_HOME = path.join(testHome, "config")
process.env.XDG_STATE_HOME = path.join(testHome, "state")
for (const dir of ["data", "cache", "config", "state"]) {
  await fs.mkdir(path.join(testHome, dir), { recursive: true })
}

const { Instance } = await import("@/project/instance")
const { Workspace } = await import("@/workspace")
const { Session } = await import("@/session")
const { Server } = await import("@/server/server")
const { runPromiseWithLayer, withCurrentInstance } = await import("@/effect")
const { Effect } = await import("effect")

async function git(directory: string, ...args: string[]) {
  const proc = Bun.spawn(["git", ...args], { cwd: directory, stdout: "pipe", stderr: "pipe" })
  if ((await proc.exited) !== 0) throw new Error(`git ${args.join(" ")} failed`)
}

describe("workspace warp (hono route)", () => {
  it("warps a session to a worktree and detaches back to local", async () => {
    const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-warp-route-project-")))
    await git(dir, "init")
    await fs.writeFile(path.join(dir, "README.md"), "# warp\n")
    await git(dir, "add", "README.md")
    await git(dir, "-c", "user.email=t@e.com", "-c", "user.name=T", "commit", "-m", "init")

    await Instance.provide({
      directory: dir,
      fn: async () => {
        const session = await runPromiseWithLayer(
          Session.defaultLayer,
          withCurrentInstance(
            Effect.gen(function* () {
              const svc = yield* Session.Service
              return yield* svc.create({ title: "warp route" })
            }),
          ),
        )
        const ws = await Workspace.create({
          projectID: Instance.project.id,
          branch: "warp/wt",
          config: { type: "worktree", directory: "" } as never,
        })

        const warp = (id: string | null) =>
          Server.App().fetch(
            new Request("http://nikcli.local/experimental/workspace/warp", {
              method: "POST",
              headers: { "content-type": "application/json", "x-nikcli-directory": dir },
              body: JSON.stringify({ id, sessionID: session.id }),
            }),
          )

        const toWorktree = await warp(ws.id)
        expect(toWorktree.status).toBe(204)

        const toLocal = await warp(null)
        expect(toLocal.status).toBe(204)
      },
    })
  })
})
