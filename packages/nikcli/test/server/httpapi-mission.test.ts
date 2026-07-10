import { afterAll, afterEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-mission-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
process.env.NIKCLI_EXPERIMENTAL_HTTPAPI = "1"

const { Instance } = await import("@/project/instance")
const { HttpApiBridge } = await import("@/server/httpapi/bridge")
const { Server } = await import("@/server/server")

const projectDirs: string[] = []

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-mission-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

async function request(pathname: string, directory: string, init?: RequestInit) {
  const url = new URL(pathname, "http://nikcli.local")
  url.searchParams.set("directory", directory)
  return Server.App().fetch(new Request(url, init))
}

function missionBody(name = "test-mission") {
  return {
    name,
    brief: "Exercise the mission HttpApi slice end to end",
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
          {
            id: "f2",
            name: "feature-2",
            agent: "general",
            objective: "Do the second thing",
            dependsOn: ["f1"],
          },
        ],
      },
    ],
  }
}

describe("Mission HttpApi", () => {
  it("advertises mission routes as supported HttpApi paths", () => {
    expect(HttpApiBridge.supports("/mission", "GET")).toBe(true)
    expect(HttpApiBridge.supports("/mission/", "GET")).toBe(true)
    expect(HttpApiBridge.supports("/mission/templates", "GET")).toBe(true)
    expect(HttpApiBridge.supports("/mission/execs/recent", "GET")).toBe(true)
    expect(HttpApiBridge.supports("/mission/generate", "POST")).toBe(true)
    expect(HttpApiBridge.supports("/mission", "PUT")).toBe(true)
    expect(HttpApiBridge.supports("/mission/mission_x", "GET")).toBe(true)
    expect(HttpApiBridge.supports("/mission/mission_x", "POST")).toBe(true)
    expect(HttpApiBridge.supports("/mission/mission_x", "DELETE")).toBe(true)
    expect(HttpApiBridge.supports("/mission/mission_x/start", "POST")).toBe(true)
    expect(HttpApiBridge.supports("/mission/mission_x/pause", "POST")).toBe(true)
    expect(HttpApiBridge.supports("/mission/mission_x/cancel", "POST")).toBe(true)
    expect(HttpApiBridge.supports("/mission/mission_x/feature/f1", "POST")).toBe(true)
    expect(HttpApiBridge.supports("/mission/mission_x/execs", "GET")).toBe(true)
  })

  it("lists missions and templates", async () => {
    const directory = await makeProjectDir()

    const list = await request("/mission", directory)
    expect(list.status).toBe(200)
    const listBody = (await list.json()) as {
      missions: unknown[]
      runtimes: unknown[]
    }
    expect(Array.isArray(listBody.missions)).toBe(true)
    expect(Array.isArray(listBody.runtimes)).toBe(true)

    const templates = await request("/mission/templates", directory)
    expect(templates.status).toBe(200)
    const templatesBody = (await templates.json()) as { templates: unknown[] }
    expect(Array.isArray(templatesBody.templates)).toBe(true)
    expect(templatesBody.templates.length).toBeGreaterThan(0)
  })

  it("upserts, reads, updates, mutates a feature, and deletes a mission", async () => {
    const directory = await makeProjectDir()

    const created = await request("/mission", directory, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(missionBody()),
    })
    expect(created.status).toBe(200)
    const mission = (await created.json()) as {
      id: string
      status: string
      milestones: Array<{
        features: Array<{ id: string; status: string; dependsOn: string[] }>
      }>
    }
    expect(mission.id).toBeTruthy()
    expect(mission.status).toBe("ready")
    // zod defaults from the legacy validator must still be applied.
    expect(mission.milestones[0].features[0].status).toBe("pending")
    expect(mission.milestones[0].features[0].dependsOn).toEqual([])

    const got = await request(`/mission/${mission.id}`, directory)
    expect(got.status).toBe(200)
    const gotBody = (await got.json()) as {
      mission: { id: string }
      runtime: { missionID: string; status: string }
    }
    expect(gotBody.mission.id).toBe(mission.id)
    expect(gotBody.runtime.missionID).toBe(mission.id)

    // Update with mismatched id must 400 with the legacy body.
    const mismatch = await request(`/mission/${mission.id}`, directory, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...gotBody.mission, id: "mission_other" }),
    })
    expect(mismatch.status).toBe(400)
    const mismatchBody = (await mismatch.json()) as {
      name: string
      data: { message: string }
    }
    expect(mismatchBody.name).toBe("ValidationError")

    const updated = await request(`/mission/${mission.id}`, directory, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...gotBody.mission, brief: "Updated brief" }),
    })
    expect(updated.status).toBe(200)
    expect(((await updated.json()) as { brief: string }).brief).toBe("Updated brief")

    const mutated = await request(`/mission/${mission.id}/feature/f1`, directory, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "done" }),
    })
    expect(mutated.status).toBe(200)
    const mutatedBody = (await mutated.json()) as {
      milestones: Array<{ features: Array<{ id: string; status: string }> }>
    }
    expect(mutatedBody.milestones[0].features.find((f) => f.id === "f1")?.status).toBe("done")

    const missingFeature = await request(`/mission/${mission.id}/feature/nope`, directory, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "done" }),
    })
    expect(missingFeature.status).toBe(404)

    const execs = await request(`/mission/${mission.id}/execs`, directory)
    expect(execs.status).toBe(200)
    expect(Array.isArray(((await execs.json()) as { execs: unknown[] }).execs)).toBe(true)

    const recent = await request("/mission/execs/recent", directory)
    expect(recent.status).toBe(200)

    const removed = await request(`/mission/${mission.id}`, directory, {
      method: "DELETE",
    })
    expect(removed.status).toBe(200)
    expect(await removed.json()).toBe(true)

    const gone = await request(`/mission/${mission.id}`, directory)
    expect(gone.status).toBe(404)
    const goneBody = (await gone.json()) as {
      name: string
      data: { message: string }
    }
    expect(goneBody.name).toBe("NotFound")
    expect(goneBody.data.message).toContain(mission.id)
  })

  it("returns the legacy 404 body for lifecycle routes on a missing mission", async () => {
    const directory = await makeProjectDir()
    for (const action of ["start", "pause", "cancel"]) {
      const response = await request(`/mission/mission_missing/${action}`, directory, {
        method: "POST",
      })
      expect(response.status).toBe(404)
      const body = (await response.json()) as { name: string }
      expect(body.name).toBe("NotFound")
    }
  })

  it("rejects an invalid create body with the legacy 400 body", async () => {
    const directory = await makeProjectDir()
    const response = await request("/mission", directory, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "broken", brief: "", milestones: [] }),
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as { name: string }
    expect(body.name).toBe("ValidationError")
  })
})

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

afterAll(async () => {
  delete process.env.NIKCLI_EXPERIMENTAL_HTTPAPI
  await Instance.disposeAll().catch(() => undefined)
  await Promise.all(projectDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  await fs.rm(testHome, { recursive: true, force: true })
})
