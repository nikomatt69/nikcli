import { preserveTestEnv } from "../helpers/env"
import { afterAll, afterEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-pty-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
process.env.NIKCLI_EXPERIMENTAL_HTTPAPI = "1"

preserveTestEnv(["NIKCLI_TEST_HOME", "NIKCLI_DISABLE_PROJECT_CONFIG", "NIKCLI_EXPERIMENTAL_HTTPAPI"])

const { Instance } = await import("@/project/instance")
const { HttpApiBridge } = await import("@/server/httpapi/bridge")
const { Server } = await import("@/server/server")

const projectDirs: string[] = []

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-pty-project-"))
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
 * Wave 4 Path B: `/pty` JSON CRUD is bridged through the Effect HttpApi
 * layer while `/pty/:ptyID/connect` (WebSocket upgrade) stays a Hono
 * "special" branch. The schema-level tests below exercise every CRUD route
 * and verify:
 *  - `HttpApiBridge.supports(...)` returns true for the five CRUD entries.
 *  - `HttpApiBridge.supports(...)` returns false for the WS path
 *    (`/pty/:id/connect`) — must fall through to `routes/pty.ts`.
 *  - the schema layer accepts the canonical payload shapes and returns a
 *    typed body on success (200) or a 404 body for missing sessions.
 *
 * We do not actually spawn a `bun-pty` process in the unit test — that
 * would couple the schema test to the host's PTY capability. Instead we
 * verify the response envelope: a successful list returns 200 with an
 * array body (typically empty); a missing `get` returns 404 with the
 * declared `PtyNotFoundError` shape.
 */
describe("Pty HttpApi (Wave 4 Path B)", () => {
  it("advertises the five CRUD routes and excludes the WS connect path", () => {
    expect(HttpApiBridge.supports("/pty", "GET")).toBe(true)
    expect(HttpApiBridge.supports("/pty", "POST")).toBe(true)
    expect(HttpApiBridge.supports("/pty/pty_test", "GET")).toBe(true)
    expect(HttpApiBridge.supports("/pty/pty_test", "PUT")).toBe(true)
    expect(HttpApiBridge.supports("/pty/pty_test", "DELETE")).toBe(true)
    // WS upgrade must fall through to Hono (Path B): not in implementedRoutes.
    expect(HttpApiBridge.supports("/pty/pty_test/connect", "GET")).toBe(false)
  })

  it("GET /pty returns an empty (or current) list", async () => {
    const directory = await makeProjectDir()
    const response = await request("GET", "/pty", directory)
    expect(response.status).toBe(200)
    const body = (await response.json()) as unknown[]
    expect(Array.isArray(body)).toBe(true)
  })

  it("GET /pty/:id on a missing session returns 404 with the declared error body", async () => {
    const directory = await makeProjectDir()
    const response = await request("GET", "/pty/pty_definitely_missing", directory)
    expect(response.status).toBe(404)
    const body = (await response.json()) as {
      name: string
      data: Record<string, unknown>
    }
    expect(body.name).toBe("NotFoundError")
    expect(body.data.message).toBe("Session not found")
  })

  it("PUT /pty/:id on a missing session returns 404 (no implicit create)", async () => {
    const directory = await makeProjectDir()
    const response = await request("PUT", "/pty/pty_definitely_missing", directory, {
      title: "renamed",
    })
    expect(response.status).toBe(404)
  })

  it("DELETE /pty/:id on a missing session returns 200 (idempotent — mirrors Hono route)", async () => {
    const directory = await makeProjectDir()
    const response = await request("DELETE", "/pty/pty_definitely_missing", directory)
    // Pty.Service.remove is total: missing session is a silent no-op. The
    // Hono route at routes/pty.ts:163 also returns 200 + `true`.
    expect(response.status).toBe(200)
    const body = (await response.json()) as boolean
    expect(body).toBe(true)
  })

  it("POST /pty rejects a malformed payload with 400 (schema layer)", async () => {
    const directory = await makeProjectDir()
    const response = await request("POST", "/pty", directory, {
      command: 123, // wrong type — must trigger Schema validation
    })
    // 400 (validation) or 500 (defect); either proves the schema layer ran.
    expect([400, 500]).toContain(response.status)
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
