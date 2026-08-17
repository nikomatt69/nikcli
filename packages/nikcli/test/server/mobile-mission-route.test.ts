import { preserveTestEnv } from "../helpers/env"
import { afterAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-mobile-mission-route-home-"))
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

const projectDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-mobile-mission-route-project-")))
const { Instance } = await import("@/project/instance")
const { Server } = await import("@/server/server")

function request(pathname: string, init?: RequestInit) {
  return Server.fetch(
    new Request(`http://nikcli.local/mobile/missions${pathname}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-nikcli-directory": projectDir,
        ...init?.headers,
      },
    }),
  )
}

function missionBody(name = "mobile mission") {
  return {
    name,
    brief: "Exercise the mobile mission facade end to end",
    milestones: [
      {
        id: "m1",
        name: "milestone-1",
        validation: "none",
        features: [
          {
            id: "f1",
            name: "feature-1",
            agent: "general",
            objective: "Do the first thing",
          },
        ],
      },
    ],
  }
}

afterAll(async () => {
  await Instance.disposeAll().catch(() => undefined)
  await fs.rm(testHome, { recursive: true, force: true })
  await fs.rm(projectDir, { recursive: true, force: true })
})

describe("mobile missions routes", () => {
  it("lists templates and manages a mission through the dedicated mobile API", async () => {
    const templates = await request("/templates")
    expect(templates.status).toBe(200)
    const listedTemplates = (await templates.json()) as { templates: Array<{ id: string }> }
    expect(listedTemplates.templates.length).toBeGreaterThan(0)

    const create = await request("", {
      method: "POST",
      body: JSON.stringify(missionBody()),
    })
    expect(create.status).toBe(200)
    const created = (await create.json()) as { id: string; name: string; status: string }
    expect(created.id).toStartWith("mission_")
    expect(created.name).toBe("mobile mission")
    expect(created.status).toBe("ready")

    const list = await request("")
    expect(list.status).toBe(200)
    const listed = (await list.json()) as {
      missions: Array<{ id: string }>
      runtimes: Array<{ missionID: string; status: string }>
    }
    expect(listed.missions.some((mission) => mission.id === created.id)).toBe(true)
    expect(listed.runtimes.find((runtime) => runtime.missionID === created.id)?.status).toBe("idle")

    const detail = await request(`/${created.id}`)
    expect(detail.status).toBe(200)
    expect(((await detail.json()) as { mission: { id: string } }).mission.id).toBe(created.id)

    expect((await request(`/${created.id}/pause`, { method: "POST" })).status).toBe(200)
    expect((await request(`/${created.id}/cancel`, { method: "POST" })).status).toBe(200)

    const execs = await request(`/${created.id}/execs`)
    expect(execs.status).toBe(200)
    expect(((await execs.json()) as { execs: unknown[] }).execs).toEqual([])

    expect((await request(`/${created.id}`, { method: "DELETE" })).status).toBe(200)
    expect((await request(`/${created.id}`)).status).toBe(404)
  })
})
