import { afterAll, afterEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-sync-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
process.env.NIKCLI_EXPERIMENTAL_HTTPAPI = "1"

const { Instance } = await import("@/project/instance")
const { HttpApiBridge } = await import("@/server/httpapi/bridge")
const { Server } = await import("@/server/server")

const projectDirs: string[] = []

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-sync-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

async function request(method: string, pathname: string, directory: string, body?: unknown) {
  const url = new URL(pathname, "http://nikcli.local")
  url.searchParams.set("directory", directory)
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" }
    init.body = JSON.stringify(body)
  }
  return Server.App().fetch(new Request(url, init))
}

/**
 * The `/sync/*` surface is served by Hono (`routes/sync.ts`); the Effect
 * `SyncHttpApi.Group` is a contract-only mirror of those routes inside
 * `PublicApi` (no handlers, not bridged). An earlier Wave 4 group exposed
 * four invented endpoints (`/sync/start|replay|history|snapshot`) that never
 * existed on the Hono side — they were dropped when the spec was realigned.
 */
describe("Sync HttpApi contract (realigned to Hono routes)", () => {
  it("no longer advertises the removed Wave 4 phantom routes on the bridge", () => {
    expect(HttpApiBridge.supports("/sync/start", "POST")).toBe(false)
    expect(HttpApiBridge.supports("/sync/replay", "POST")).toBe(false)
    expect(HttpApiBridge.supports("/sync/history", "GET")).toBe(false)
    expect(HttpApiBridge.supports("/sync/snapshot", "GET")).toBe(false)
  })

  it("describes the real /sync routes with the Hono operationIds", async () => {
    const { OpenApi } = await import("effect/unstable/httpapi")
    const { PublicApi } = await import("@/server/httpapi/public")
    const spec = OpenApi.fromApi(PublicApi) as {
      paths: Record<string, Record<string, { operationId?: string }>>
    }
    const op = (p: string, m: string) => spec.paths[p]?.[m]?.operationId
    expect(op("/sync/event", "post")).toBe("sync.event.push")
    expect(op("/sync/outbox", "get")).toBe("sync.outbox.list")
    expect(op("/sync/snapshot/{aggregateID}", "get")).toBe("sync.snapshot.get")
    expect(op("/sync/stream", "get")).toBe("sync.event.stream")
    expect(op("/sync/stats", "get")).toBe("sync.stats")
    expect(op("/sync/config", "post")).toBe("sync.config.set")
    expect(op("/sync/connect", "post")).toBe("sync.connect")
    expect(op("/sync/disconnect", "post")).toBe("sync.disconnect")
    expect(op("/sync/drain", "post")).toBe("sync.drain")
    // The phantom endpoints must not resurface.
    expect(spec.paths["/sync/start"]).toBeUndefined()
    expect(spec.paths["/sync/history"]).toBeUndefined()
  })

  it("GET /sync/outbox returns an empty page when no events exist (Hono)", async () => {
    const directory = await makeProjectDir()
    const response = await request("GET", "/sync/outbox?projectID=proj_1", directory)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { events: unknown[]; hasMore: boolean }
    expect(Array.isArray(body.events)).toBe(true)
    expect(body.events.length).toBe(0)
    expect(body.hasMore).toBe(false)
  })

  it("GET /sync/snapshot/:aggregateID rejects unsupported aggregate kinds (Hono)", async () => {
    const directory = await makeProjectDir()
    const response = await request("GET", "/sync/snapshot/unknown_1?projectID=proj_1", directory)
    expect(response.status).toBe(400)
  })
})

/**
 * Auth tests for the `?token=` security scheme on `/sync/*`. Mirrors the
 * Hono scope guard at `routes/sync.ts`:
 *  - invalid token → 401
 *  - valid token with sync-capable scope (`mobile`, `cli-sync`) → 200
 */
describe("Sync auth_token scope guard", () => {
  it("rejects ?token=<unknown> with 401 Unauthorized", async () => {
    const directory = await makeProjectDir()
    const response = await request("GET", "/sync/outbox?token=invalid_token_xyz&projectID=proj_1", directory)
    expect(response.status).toBe(401)
    const body = await response.text()
    expect(body).toContain("Unauthorized")
  })

  it("accepts ?token=<mobile-scope>", async () => {
    const { MobileAuth } = await import("@/mobile/auth")
    const directory = await makeProjectDir()
    const created = await MobileAuth.create({
      name: "test-mobile",
      scope: "mobile",
    })
    const response = await request("GET", `/sync/outbox?token=${created.token}&projectID=proj_1`, directory)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { events: unknown[]; hasMore: boolean }
    expect(Array.isArray(body.events)).toBe(true)
  })

  it("accepts ?token=<cli-sync-scope>", async () => {
    const { MobileAuth } = await import("@/mobile/auth")
    const directory = await makeProjectDir()
    const created = await MobileAuth.create({
      name: "test-cli-sync",
      scope: "cli-sync",
    })
    const response = await request("GET", `/sync/outbox?token=${created.token}&projectID=proj_1`, directory)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { events: unknown[]; hasMore: boolean }
    expect(Array.isArray(body.events)).toBe(true)
  })
})

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

afterAll(async () => {
  await Promise.all(projectDirs.map((dir) => fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)))
  await fs.rm(testHome, { recursive: true, force: true }).catch(() => undefined)
})
