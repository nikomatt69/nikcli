import { preserveTestEnv } from "../helpers/env"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterAll, describe, expect, it } from "bun:test"
import { Hono } from "hono"

const testDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-sync-auth-"))
process.env.NIKCLI_TEST_HOME = testDir
process.env.NIKCLI_DB = path.join(testDir, "nikcli.db")

preserveTestEnv(["NIKCLI_TEST_HOME", "NIKCLI_DB"])

const { SyncRoutes } = await import("@/server/routes/sync")

const run = Math.random().toString(36).slice(2)

afterAll(async () => {
  await fs.rm(testDir, { recursive: true, force: true })
})

type FakeToken = { id: string; name: string; scope: string; createdAt: number }

// Mirrors the server-level middleware contract: a verified bearer token is
// exposed to nested routers via c.set("mobileAuth", token).
function appWith(token?: FakeToken) {
  return new Hono()
    .use("*", async (c, next) => {
      if (token) (c as any).set("mobileAuth", token)
      return next()
    })
    .route("/sync", SyncRoutes)
}

let eventCounter = 0
function pushRequest(projectID: string) {
  eventCounter++
  return new Request("http://localhost/sync/event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      event: {
        id: `syn_auth_${run}_${eventCounter}`,
        projectId: projectID,
        aggregate: `wrk_auth_${run}`,
        seq: eventCounter,
        type: "session.idle",
        data: { type: "session.idle", properties: {} },
        timestamp: Date.now(),
      },
      projectID,
    }),
  })
}

describe("SyncRoutes auth", () => {
  it("accepts mobile, cli-sync, and studio bearer scopes", async () => {
    const mobile = appWith({ id: `mat_${run}_mobile`, name: "iphone", scope: "mobile", createdAt: Date.now() })
    expect((await mobile.request(pushRequest(`proj_auth_${run}`))).status).toBe(204)

    const cliSync = appWith({ id: `mat_${run}_cli`, name: "cli", scope: "cli-sync", createdAt: Date.now() })
    expect((await cliSync.request(pushRequest(`proj_auth_${run}`))).status).toBe(204)

    const studio = appWith({ id: `mat_${run}_studio`, name: "studio", scope: "studio", createdAt: Date.now() })
    expect((await studio.request(pushRequest(`proj_auth_${run}`))).status).toBe(204)

    const operator = appWith()
    expect((await operator.request(pushRequest(`proj_auth_${run}`))).status).toBe(204)
  })

  it("rate limits event pushes per token", async () => {
    const token: FakeToken = { id: `mat_${run}_flood`, name: "flood", scope: "cli-sync", createdAt: Date.now() }
    const app = appWith(token)
    const projectID = `proj_flood_${run}`

    let limited: Response | undefined
    for (let i = 0; i < 101; i++) {
      const res = await app.request(pushRequest(projectID))
      if (res.status === 429) {
        limited = res
        break
      }
      expect(res.status).toBe(204)
    }

    expect(limited).toBeDefined()
    expect(Number(limited!.headers.get("retry-after"))).toBeGreaterThan(0)

    // Other identities are unaffected by the flooded token's window.
    const other = appWith({ id: `mat_${run}_other`, name: "other", scope: "cli-sync", createdAt: Date.now() })
    expect((await other.request(pushRequest(projectID))).status).toBe(204)
  })
})
