import { preserveTestEnv } from "../helpers/env"
import { removeTestDir } from "../helpers/fs"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterAll, describe, expect, it } from "bun:test"

const testDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-sync-auth-"))
process.env.NIKCLI_TEST_HOME = testDir
process.env.NIKCLI_DB = path.join(testDir, "nikcli.db")

preserveTestEnv(["NIKCLI_TEST_HOME", "NIKCLI_DB"])

const { MobileAuth } = await import("@/mobile/auth")
const { Server } = await import("@/server/server")

const run = Math.random().toString(36).slice(2)

afterAll(async () => {
  await removeTestDir(testDir)
})

async function token(scope: "mobile" | "cli-sync" | "studio", name: string) {
  return (await MobileAuth.create({ name, scope })).token
}

let eventCounter = 0
function pushRequest(projectID: string, bearer?: string) {
  eventCounter++
  return new Request("http://localhost/sync/event", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
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
    expect((await Server.fetch(pushRequest(`proj_auth_${run}`, await token("mobile", "iphone")))).status).toBe(204)
    expect((await Server.fetch(pushRequest(`proj_auth_${run}`, await token("cli-sync", "cli")))).status).toBe(204)
    expect((await Server.fetch(pushRequest(`proj_auth_${run}`, await token("studio", "studio")))).status).toBe(204)
    expect((await Server.fetch(pushRequest(`proj_auth_${run}`))).status).toBe(204)
  })

  it("rate limits event pushes per token", async () => {
    const flood = await token("cli-sync", "flood")
    const projectID = `proj_flood_${run}`

    let limited: Response | undefined
    for (let i = 0; i < 101; i++) {
      const res = await Server.fetch(pushRequest(projectID, flood))
      if (res.status === 429) {
        limited = res
        break
      }
      expect(res.status).toBe(204)
    }

    expect(limited).toBeDefined()
    expect(Number(limited!.headers.get("retry-after"))).toBeGreaterThan(0)

    const other = await token("cli-sync", "other")
    expect((await Server.fetch(pushRequest(projectID, other))).status).toBe(204)
  })
})
