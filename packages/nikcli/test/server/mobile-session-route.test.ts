import { afterAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-mobile-session-route-home-"))
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

const projectDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-mobile-session-route-project-")))
const { Instance } = await import("@/project/instance")
const { Server } = await import("@/server/server")

function request(pathname: string, init?: RequestInit) {
  return Server.App().fetch(
    new Request(`http://nikcli.local/mobile${pathname}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-nikcli-directory": projectDir,
        ...(init?.headers ?? {}),
      },
    }),
  )
}

afterAll(async () => {
  await Instance.disposeAll().catch(() => undefined)
  await fs.rm(testHome, { recursive: true, force: true })
  await fs.rm(projectDir, { recursive: true, force: true })
})

describe("mobile session routes", () => {
  it("creates a session and lists it back from the SQL store", async () => {
    const create = await request("/session", {
      method: "POST",
      body: JSON.stringify({ title: "Mobile session test" }),
    })
    expect(create.status).toBe(200)
    const created = (await create.json()) as { id: string; title: string }
    expect(created.id).toStartWith("ses")

    // Regression guard for the resurrected `routes/mobile.ts` monolith, which
    // shadowed the split `routes/mobile/` modules (Node resolves the `.ts` file
    // before the directory). The stale monolith listed sessions from the old
    // file store via `storageList(["session"])`, so after the SQL migration the
    // mobile list screen always came back empty. The created session must now
    // appear in the SQL-backed list.
    const list = await request("/session")
    expect(list.status).toBe(200)
    const listed = (await list.json()) as Array<{ info: { id: string; title: string } }>
    expect(listed.some((entry) => entry.info.id === created.id)).toBe(true)
  })
})
