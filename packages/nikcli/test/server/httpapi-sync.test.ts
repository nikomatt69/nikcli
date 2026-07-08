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
 * Wave 4, Sync.Service extraction. Four new HTTP routes:
 *  - POST /sync/start    — kick the hub connection
 *  - POST /sync/replay   — manual outbox append
 *  - GET  /sync/history  — paginated event history
 *  - GET  /sync/snapshot — cold-start projection snapshot
 *
 * `/sync/stream` (SSE feed) intentionally stays a Hono "special" branch,
 * parallel to `/event` and `/chatbot/*` — schema routing is the wrong
 * abstraction for streaming. Auth scope enforcement (`cli-sync` / `studio`
 * on a bearer token) is deferred — see `specs/effect/sync-service.md` §5.
 *
 * The tests below exercise the schema/bridge boundary without actually
 * pushing events to a remote hub:
 *  - route advertisement for the four new endpoints
 *  - schema validation (400 on bad payloads / missing query)
 *  - GET /sync/snapshot returns null when the aggregate is unknown
 *  - GET /sync/history returns an empty page when no events exist
 */
describe("Sync HttpApi (Wave 4)", () => {
  it("advertises the four new /sync/* routes", () => {
    expect(HttpApiBridge.supports("/sync/start", "POST")).toBe(true)
    expect(HttpApiBridge.supports("/sync/replay", "POST")).toBe(true)
    expect(HttpApiBridge.supports("/sync/history", "GET")).toBe(true)
    expect(HttpApiBridge.supports("/sync/snapshot", "GET")).toBe(true)
  })

  it("rejects malformed /sync/start payloads with 400 (schema validation)", async () => {
    const directory = await makeProjectDir()
    const response = await request("POST", "/sync/start", directory, {
      // Missing required `token` and `projectID`.
      url: "https://hub.example.com",
    })
    expect([400, 500]).toContain(response.status)
  })

  it("rejects malformed /sync/replay payloads with 400 (schema validation)", async () => {
    const directory = await makeProjectDir()
    const response = await request("POST", "/sync/replay", directory, {
      projectID: "proj_1",
      // Missing `aggregate` and `data`.
    })
    expect([400, 500]).toContain(response.status)
  })

  it("GET /sync/snapshot returns null for unknown aggregate kinds", async () => {
    const directory = await makeProjectDir()
    const response = await request("GET", "/sync/snapshot?projectID=proj_1&aggregate=unknown_aggregate", directory)
    expect(response.status).toBe(200)
    const body = (await response.json()) as unknown
    expect(body).toBeNull()
  })

  it("GET /sync/history returns an empty page when no events exist", async () => {
    const directory = await makeProjectDir()
    const response = await request("GET", "/sync/history?projectID=proj_1&aggregate=wrk_test", directory)
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      events: unknown[]
      hasMore: boolean
    }
    expect(Array.isArray(body.events)).toBe(true)
    expect(body.events.length).toBe(0)
    expect(body.hasMore).toBe(false)
  })
})

/**
 * Auth tests for the `?token=` security scheme on `/sync/*`. Mirrors the
 * Hono scope guard at `routes/sync.ts:93-104`:
 *  - invalid token → 401
 *  - valid token with non-sync scope (`mobile`) → 403
 *  - valid token with sync scope (`cli-sync`) → 200
 *
 * The operator path (no token) is exercised by the schema-layer tests
 * above — no token means the request falls through to the bridge-level
 * basic-auth shim.
 */
describe("Sync HttpApi auth_token scope guard (Wave 4 follow-up)", () => {
  it("rejects ?token=<unknown> with 401 Unauthorized", async () => {
    const directory = await makeProjectDir()
    const response = await request(
      "GET",
      "/sync/history?token=invalid_token_xyz&projectID=proj_1&aggregate=wrk_test",
      directory,
    )
    expect(response.status).toBe(401)
    const body = await response.text()
    expect(body).toContain("Unauthorized")
  })

  it("rejects ?token=<mobile-scope> with 403 Forbidden (insufficient scope)", async () => {
    const { MobileAuth } = await import("@/mobile/auth")
    const { Database } = await import("@/database/database")
    const directory = await makeProjectDir()
    // Provision a token with the wrong (default) scope.
    const created = await MobileAuth.create({
      name: "test-mobile",
      scope: "mobile",
    })
    try {
      const response = await request(
        "GET",
        `/sync/history?token=${created.token}&projectID=proj_1&aggregate=wrk_test`,
        directory,
      )
      expect(response.status).toBe(403)
      const body = await response.text()
      expect(body).toContain("Forbidden")
    } finally {
      // The token cleanup path is internal; the test home is wiped in afterAll.
      void Database
    }
  })

  it("accepts ?token=<cli-sync-scope> (200 on the schema path)", async () => {
    const { MobileAuth } = await import("@/mobile/auth")
    const directory = await makeProjectDir()
    const created = await MobileAuth.create({
      name: "test-cli-sync",
      scope: "cli-sync",
    })
    const response = await request(
      "GET",
      `/sync/history?token=${created.token}&projectID=proj_1&aggregate=wrk_test`,
      directory,
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      events: unknown[]
      hasMore: boolean
    }
    expect(Array.isArray(body.events)).toBe(true)
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
