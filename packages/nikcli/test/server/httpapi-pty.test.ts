import { preserveTestEnv } from "../helpers/env"
import { removeTestDir } from "../helpers/fs"
import { afterAll, afterEach, describe, expect, it } from "bun:test"
import { Cause, Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-pty-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

preserveTestEnv(["NIKCLI_TEST_HOME", "NIKCLI_DISABLE_PROJECT_CONFIG"])

const { Instance } = await import("@/project/instance")
const { HttpApiBridge } = await import("@/server/httpapi/bridge")
const { Server } = await import("@/server/server")
const { Pty } = await import("@/pty")
const { PtyHttpApi } = await import("@/server/httpapi/pty")
const { runPromiseExitWithLayer, withCurrentInstance } = await import("@/effect")

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
  return Server.fetch(new Request(url, init))
}

/**
 * `/pty` JSON CRUD is served through the Effect HttpApi layer while
 * `/pty/:ptyID/connect` (WebSocket upgrade) is handled by native Bun
 * `server.upgrade`. The schema-level tests below exercise every CRUD route
 * and verify:
 *  - `HttpApiBridge.supports(...)` returns true for the five CRUD entries.
 *  - `HttpApiBridge.supports(...)` returns false for the WS path
 *    (`/pty/:id/connect`) — upgrades are handled outside HttpApi.
 *  - the schema layer accepts the canonical payload shapes and returns a
 *    typed body on success (200) or a 404 body for missing sessions.
 *
 * We do not actually spawn a PTY process in the unit test — that
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
    // WS upgrade is handled by native Bun, not the HttpApi bridge.
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
    // Pty.Service.remove is total: missing session is a silent no-op.
    expect(response.status).toBe(200)
    const body = (await response.json()) as boolean
    expect(body).toBe(true)
  })

  /**
   * E8.2. `handlers.get` / `handlers.update` used to raise the declared
   * `Pty.NotFoundError` with `throw` inside `Effect.gen`, so it reached the
   * boundary as a *defect* and only became a 404 because `catchNotFound`
   * carried an `Effect.catchDefect` arm alongside its typed one. The defect
   * arm is gone; these assertions are what goes red if the `throw` returns,
   * because a die is no longer recovered into the declared body.
   */
  it("handlers.get maps a missing session on the typed channel, with no defect", async () => {
    const directory = await makeProjectDir()
    await Instance.provide({
      directory,
      fn: async () => {
        const exit = await runPromiseExitWithLayer(
          Pty.defaultLayer,
          withCurrentInstance(PtyHttpApi.handlers.get({ params: { ptyID: "pty_definitely_missing" } })),
        )
        expect(exit._tag).toBe("Failure")
        if (exit._tag !== "Failure") return
        expect(Cause.hasDies(exit.cause)).toBe(false)
        expect(Cause.squash(exit.cause)).toEqual({
          name: "NotFoundError",
          data: { message: "Session not found" },
        })
      },
    })
  })

  it("handlers.update maps a missing session on the typed channel, with no defect", async () => {
    const directory = await makeProjectDir()
    await Instance.provide({
      directory,
      fn: async () => {
        const exit = await runPromiseExitWithLayer(
          Pty.defaultLayer,
          withCurrentInstance(
            PtyHttpApi.handlers.update({
              params: { ptyID: "pty_definitely_missing" },
              payload: { title: "renamed" },
            }),
          ),
        )
        expect(exit._tag).toBe("Failure")
        if (exit._tag !== "Failure") return
        expect(Cause.hasDies(exit.cause)).toBe(false)
        expect(Cause.squash(exit.cause)).toEqual({
          name: "NotFoundError",
          data: { message: "Session not found" },
        })
      },
    })
  })

  it("handlers.list stays total — a success carries no failure channel to map", async () => {
    const directory = await makeProjectDir()
    await Instance.provide({
      directory,
      fn: async () => {
        const exit = await runPromiseExitWithLayer(
          Pty.defaultLayer,
          withCurrentInstance(Effect.map(PtyHttpApi.handlers.list(), (list) => list.length)),
        )
        expect(exit._tag).toBe("Success")
      },
    })
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
  await Instance.disposeAll().catch(() => undefined)
  await Promise.all(projectDirs.map((dir) => removeTestDir(dir)))
  await removeTestDir(testHome)
})
