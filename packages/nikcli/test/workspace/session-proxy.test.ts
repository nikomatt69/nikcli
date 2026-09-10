import { preserveTestEnv } from "../helpers/env"
import { removeTestDir } from "../helpers/fs"
import { afterAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

/**
 * The routing decisions in `src/workspace/session-proxy-middleware.ts`
 * ([specs/v2/workspace-trust-lattice.md](../../../../specs/v2/workspace-trust-lattice.md)).
 *
 * The middleware is a proxy, not an allow/deny lattice: the questions it
 * answers are which requests may be forwarded at all, and what a request
 * naming a workspace that does not exist gets back. Both are worth pinning
 * because "fall through to the local handler" and "forward to another host"
 * are very different answers to the same URL.
 */

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-session-proxy-home-"))
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

const projectDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-session-proxy-project-")))
const { Instance } = await import("@/project/instance")
const { WorkspaceContext } = await import("@/workspace/workspace-context")
const { proxySessionRequest, withSessionProxy } = await import("@/workspace/session-proxy-middleware")
const { WorkspaceDB } = await import("@/workspace/db")

// A container workspace resolves to `{ type: "remote", url: serverUrl }` by
// reading its config alone — no runtime is started — so a stub server is
// enough to observe the forwarding leg.
const forwarded: Array<{ method: string; pathname: string; body: string }> = []
const remoteHost = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url)
    forwarded.push({ method: req.method, pathname: url.pathname, body: await req.text() })
    return Response.json({ served: "by the remote workspace" })
  },
})

const REMOTE_WORKSPACE = "wrk_remote_stub"
// `Bun.serve({ port: 0 })` always resolves a port; the type does not say so.
const remotePort = remoteHost.port!

async function inInstance<T>(fn: () => Promise<T>): Promise<T> {
  // `provide` hands back whatever `fn` returns, so its type is one Promise
  // deeper than the value; awaiting here flattens it for every caller.
  return await Instance.provide({ directory: projectDir, fn })
}

afterAll(async () => {
  remoteHost.stop(true)
  await Instance.disposeAll().catch(() => undefined)
  await removeTestDir(testHome)
  await removeTestDir(projectDir)
})

describe("workspace session proxy", () => {
  it("never proxies a GET, even with a workspace bound on the request context", async () => {
    const decision = await inInstance(() =>
      WorkspaceContext.restore("wrk_absent_from_this_database", () =>
        proxySessionRequest(new Request("http://nikcli.local/session/ses_x", { method: "GET" })),
      ),
    )
    // undefined means "not mine": the local handler answers.
    expect(decision).toBeUndefined()
  })

  it("ignores a workspace id that is not a wrk_ identifier", async () => {
    const decision = await inInstance(() =>
      proxySessionRequest(
        new Request("http://nikcli.local/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workspaceID: "/some/directory" }),
        }),
      ),
    )
    expect(decision).toBeUndefined()
  })

  it("falls through when no workspace can be resolved from the request", async () => {
    const decision = await inInstance(() =>
      proxySessionRequest(
        new Request("http://nikcli.local/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "no workspace here" }),
        }),
      ),
    )
    expect(decision).toBeUndefined()
  })

  it("answers 404 for a known-shaped workspace id this installation does not have", async () => {
    const response = await inInstance(() =>
      proxySessionRequest(
        new Request("http://nikcli.local/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workspaceID: "wrk_absent_from_this_database" }),
        }),
      ),
    )
    expect(response?.status).toBe(404)
    expect(await response?.text()).toContain("wrk_absent_from_this_database")
  })

  it("forwards a non-GET request for a remote workspace to that workspace's server", async () => {
    const response = await inInstance(async () => {
      const instance = (await import("@/effect")).InstanceState.ambient()
      WorkspaceDB.upsert({
        id: REMOTE_WORKSPACE,
        projectID: instance.project.id,
        name: "remote stub",
        branch: null,
        timeUsed: Date.now(),
        config: {
          type: "container",
          directory: projectDir,
          runtime: "docker",
          image: "nikcli/workspace:test",
          containerName: "nikcli-workspace-test",
          port: remotePort,
          serverUrl: `http://127.0.0.1:${remotePort}`,
        },
      })
      return proxySessionRequest(
        new Request("http://nikcli.local/session/ses_remote/message", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workspaceID: REMOTE_WORKSPACE, text: "hello" }),
        }),
      )
    })

    expect(response?.status).toBe(200)
    expect(await response?.json()).toEqual({ served: "by the remote workspace" })
    expect(forwarded).toHaveLength(1)
    expect(forwarded[0].method).toBe("POST")
    expect(forwarded[0].pathname).toBe("/session/ses_remote/message")
    expect(JSON.parse(forwarded[0].body)).toMatchObject({ text: "hello" })
  })

  it("still does not forward a GET for that same remote workspace", async () => {
    const before = forwarded.length
    const decision = await inInstance(() =>
      WorkspaceContext.restore(REMOTE_WORKSPACE, () =>
        proxySessionRequest(new Request("http://nikcli.local/session/ses_remote", { method: "GET" })),
      ),
    )
    expect(decision).toBeUndefined()
    expect(forwarded).toHaveLength(before)
  })

  it("withSessionProxy hands an unproxied request to the next handler", async () => {
    const response = await inInstance(() =>
      withSessionProxy(
        new Request("http://nikcli.local/session/ses_x", { method: "GET" }),
        async () => new Response("local handler", { status: 200 }),
      ),
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toBe("local handler")
  })
})
