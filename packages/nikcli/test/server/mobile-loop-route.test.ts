import { preserveTestEnv } from "../helpers/env"
import { afterAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-mobile-loop-route-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_TEST_MODE = "1"
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
process.env.XDG_DATA_HOME = path.join(testHome, "data")
process.env.XDG_CACHE_HOME = path.join(testHome, "cache")
process.env.XDG_CONFIG_HOME = path.join(testHome, "config")
process.env.XDG_STATE_HOME = path.join(testHome, "state")

preserveTestEnv([
  "NIKCLI_TEST_HOME",
  "NIKCLI_TEST_MODE",
  "NIKCLI_DISABLE_PROJECT_CONFIG",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
])
for (const dir of ["data", "cache", "config", "state"]) {
  await fs.mkdir(path.join(testHome, dir), { recursive: true })
}

const projectDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-mobile-loop-route-project-")))
const { Instance } = await import("@/project/instance")
const { Server } = await import("@/server/server")

function request(pathname: string, init?: RequestInit) {
  return Server.fetch(
    new Request(`http://nikcli.local/mobile/loops${pathname}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-nikcli-directory": projectDir,
        ...init?.headers,
      },
    }),
  )
}

afterAll(async () => {
  await Instance.disposeAll().catch(() => undefined)
  await fs.rm(testHome, { recursive: true, force: true })
  await fs.rm(projectDir, { recursive: true, force: true })
})

describe("mobile loops routes", () => {
  it("manages a loop through the dedicated mobile API", async () => {
    const create = await request("", {
      method: "POST",
      body: JSON.stringify({
        name: "mobile route",
        stages: [{ name: "work", agent: "ralph", objective: "Keep the mobile route verified" }],
        trigger: { kind: "manual" },
        enabled: true,
      }),
    })
    expect(create.status).toBe(200)
    const created = (await create.json()) as { id: string; enabled: boolean }
    expect(created.id).toStartWith("loop_")
    expect(created.enabled).toBe(true)

    const list = await request("")
    expect(list.status).toBe(200)
    const listed = (await list.json()) as {
      loops: Array<{ id: string }>
      runtimes: Array<{ loopID: string; status: string }>
    }
    expect(listed.loops.some((loop) => loop.id === created.id)).toBe(true)
    expect(listed.runtimes.find((runtime) => runtime.loopID === created.id)?.status).toBe("idle")

    const update = await request(`/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: "mobile route updated",
        stages: [{ name: "work", agent: "ralph", objective: "Keep the mobile route verified" }],
        trigger: { kind: "interval", everyMs: 60_000 },
        maxRuns: 3,
        enabled: true,
      }),
    })
    expect(update.status).toBe(200)
    expect(((await update.json()) as { name: string }).name).toBe("mobile route updated")

    expect((await request(`/${created.id}/pause`, { method: "POST" })).status).toBe(200)
    const paused = (await (await request(`/${created.id}`)).json()) as { runtime: { status: string } }
    expect(paused.runtime.status).toBe("paused")

    expect((await request(`/${created.id}/resume`, { method: "POST" })).status).toBe(200)
    const resumed = (await (await request(`/${created.id}`)).json()) as { runtime: { status: string } }
    expect(resumed.runtime.status).toBe("idle")

    const toggle = await request(`/${created.id}/toggle`, {
      method: "POST",
      body: JSON.stringify({ enabled: false }),
    })
    expect(toggle.status).toBe(200)
    expect(((await toggle.json()) as { enabled: boolean }).enabled).toBe(false)

    const runs = await request(`/${created.id}/runs`)
    expect(runs.status).toBe(200)
    expect(((await runs.json()) as { runs: unknown[] }).runs).toEqual([])

    expect((await request(`/${created.id}`, { method: "DELETE" })).status).toBe(200)
    expect((await request(`/${created.id}`)).status).toBe(404)
  })
})
