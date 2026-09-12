import { describe, expect, it } from "bun:test"
import { companionResponse } from "../../src/server/companion"
import { ServerRouter } from "../../src/server/server-router"
import { Server } from "../../src/server/server"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionError } from "@/session/error"
import { SessionRepo } from "@/session/repo"
import { sessionInfo } from "@/session/session.sql"
import { WorkspaceDB } from "@/workspace/db"
import { workspace } from "@/workspace/workspace.sql"
import { SandboxRegistry } from "@/sandbox/registry"
import { Database } from "@/database/database"
import { withIsolatedDatabase } from "../helpers/sqlite"
import { eq } from "drizzle-orm"
import fs from "fs/promises"
import path from "path"

function contextRequest(pathname: string, directory?: string, workspaceID?: string) {
  const url = new URL(pathname, "http://nikcli.local")
  if (directory !== undefined) url.searchParams.set("directory", directory)
  if (workspaceID !== undefined) url.searchParams.set("workspace", workspaceID)
  return new Request(url)
}

async function withContextFixture(fn: (fixture: { directory: string; session: Session.Info }) => Promise<void>) {
  await withIsolatedDatabase(async ({ home }) => {
    const directory = path.join(await fs.realpath(home), "request")
    const sessionDirectory = path.join(await fs.realpath(home), "session")
    await Promise.all([fs.mkdir(directory), fs.mkdir(sessionDirectory)])
    try {
      const initialized = await Server.fetch(contextRequest("/path", directory))
      expect(initialized.status).toBe(200)
      const created = await Server.fetch(
        new Request(contextRequest("/session", sessionDirectory), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
      )
      expect(created.status).toBe(200)
      const session = Session.Info.parse(await created.json())
      await fn({ directory, session })
    } finally {
      await Instance.disposeAll()
      SandboxRegistry.clearCache()
    }
  })
}

function putWorkspace(session: Session.Info, config: WorkspaceDB.Info["config"]) {
  return WorkspaceDB.upsert({
    id: "wrk_router_context",
    projectID: session.projectID,
    name: "router-context",
    branch: null,
    timeUsed: 1,
    config,
  })
}

describe("framework-neutral server router", () => {
  it("serves companion HTML without Hono", async () => {
    const response = companionResponse(new Request("http://nikcli.local/companion?host=https://example.com"))
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/html")
    expect(await response.text()).toContain("const API_BASE = 'https://example.com';")
  })

  it("handles CORS preflight before fallback", async () => {
    let fallbackCalled = false
    const handle = ServerRouter.make({
      fallback: async () => {
        fallbackCalled = true
        return new Response("fallback")
      },
      corsWhitelist: ["https://client.example"],
    })
    const response = await handle(
      new Request("http://nikcli.local/session", {
        method: "OPTIONS",
        headers: { origin: "https://client.example" },
      }),
    )
    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-origin")).toBe("https://client.example")
    expect(response.headers.get("access-control-allow-headers")).toContain("x-nikcli-directory")
    expect(fallbackCalled).toBe(false)
  })

  it("maps framework errors to the existing redacted shape", async () => {
    const response = ServerRouter.mapError(new Error("boom"))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      name: "Unknown",
      data: { message: "boom" },
    })
  })

  it("serves the framework-neutral facade through BunHttpServer", async () => {
    const server = await Server.listenEffect({
      port: 0,
      hostname: "127.0.0.1",
    })
    try {
      const response = await fetch(new URL("/global/health", server.url))
      expect(response.status).toBe(200)
    } finally {
      await server.stop()
    }
  })
})

describe("server request context", () => {
  it("resolves query, header, cwd, and malformed directory encoding consistently", async () => {
    for (const [request, directory] of [
      [new Request("http://nikcli.local/path"), process.cwd()],
      [
        new Request("http://nikcli.local/path", {
          headers: { "x-nikcli-directory": "/header" },
        }),
        "/header",
      ],
      [
        new Request("http://nikcli.local/path?directory=%2Fquery", {
          headers: { "x-nikcli-directory": "/header" },
        }),
        "/query",
      ],
      [contextRequest("/path", "/malformed%escape"), "/malformed%escape"],
    ] as const) {
      expect(await ServerRouter.context(request)).toEqual({
        directory,
        workspaceID: undefined,
        target: undefined,
      })
    }
  })

  it("pins concurrent session requests to their rows despite stale query and header directories", async () => {
    await withContextFixture(async ({ directory, session }) => {
      const other = { ...session, id: "ses_router_other", directory }
      SessionRepo.upsert(other)
      const requests = [
        contextRequest(`/session/${session.id}/message`, directory),
        new Request(`http://nikcli.local/session/${session.id}`, {
          headers: { "x-nikcli-directory": directory },
        }),
        contextRequest(`/session/${other.id}/message`, session.directory),
        contextRequest(`/session/%73${session.id.slice(1)}`, directory),
      ]
      const contexts = await Promise.all(requests.map((request) => ServerRouter.context(request)))
      expect(contexts.map((context) => context.directory)).toEqual([
        session.directory,
        session.directory,
        directory,
        session.directory,
      ])
      const response = await Server.fetch(requests[1])
      expect(response.status).toBe(200)
      expect(Session.Info.parse(await response.json()).directory).toBe(session.directory)
    })
  })

  it("ignores non-session paths and missing sessions without hiding a real 404", async () => {
    await withContextFixture(async ({ directory }) => {
      for (const pathname of ["/session/status", "/session/%invalid", "/sessions/ses_other", "/session/ses_missing"]) {
        expect(await ServerRouter.context(contextRequest(pathname, directory))).toEqual({
          directory,
          workspaceID: undefined,
          target: undefined,
        })
      }
      const response = await Server.fetch(contextRequest("/session/ses_missing", directory))
      expect(response.status).toBe(404)
      expect(await response.json()).toMatchObject({ name: "NotFoundError" })
    })
  })

  it("lets a derived local workspace override both session and requested directories", async () => {
    await withContextFixture(async ({ directory, session }) => {
      const space = putWorkspace(session, {
        type: "worktree",
        directory: path.join(directory, "workspace"),
      })
      SessionRepo.upsert({ ...session, workspaceID: space.id })
      expect(await ServerRouter.context(contextRequest(`/session/${session.id}`, directory))).toEqual({
        directory: space.config.directory,
        workspaceID: space.id,
        target: { type: "local", directory: space.config.directory },
      })
    })
  })

  it("retains the session directory when its workspace target is remote", async () => {
    await withContextFixture(async ({ directory, session }) => {
      const space = putWorkspace(session, {
        type: "container",
        directory: "/remote/project",
        runtime: "docker",
        image: "test-image",
        containerName: "test-container",
        port: 4096,
        serverUrl: "http://127.0.0.1:4096",
      })
      SessionRepo.upsert({ ...session, workspaceID: space.id })
      const resolved = await ServerRouter.context(contextRequest(`/session/${session.id}`, directory))
      expect(resolved.target?.type).toBe("remote")
      expect(resolved.workspaceID).toBe(space.id)
      expect(resolved.directory).toBe(session.directory)
    })
  })

  it("skips the session read for explicit query and header workspaces", async () => {
    await withContextFixture(async ({ directory, session }) => {
      const space = putWorkspace(session, {
        type: "worktree",
        directory: session.directory,
      })
      Database.syncDb().update(sessionInfo).set({ data: "{" }).where(eq(sessionInfo.id, session.id)).run()
      const query = contextRequest(`/session/${session.id}`, directory, space.id)
      const header = new Request(contextRequest(`/session/${session.id}`, directory), {
        headers: { "x-nikcli-workspace": space.id },
      })
      const precedence = new Request(query, {
        headers: { "x-nikcli-workspace": "wrk_missing" },
      })
      for (const request of [query, header, precedence]) {
        const resolved = await ServerRouter.context(request)
        expect(resolved.workspaceID).toBe(space.id)
        expect(resolved.directory).toBe(session.directory)
      }
    })
  })

  it("does not dispatch under request context after a session read fails", async () => {
    await withContextFixture(async ({ directory, session }) => {
      Database.syncDb().update(sessionInfo).set({ data: "{" }).where(eq(sessionInfo.id, session.id)).run()
      const request = contextRequest(`/session/${session.id}/context-probe`, directory)
      await expect(ServerRouter.context(request)).rejects.toBeInstanceOf(SessionError.IOError)
      let dispatched = false
      const handle = ServerRouter.make({
        fallback: async () => {
          dispatched = true
          return new Response("unexpected dispatch")
        },
      })
      const response = await handle(request)
      expect(response.status).toBe(500)
      expect(await response.json()).toMatchObject({ name: "Unknown" })
      expect(dispatched).toBe(false)
    })
  })

  it("does not disguise a malformed workspace record as a missing workspace", async () => {
    await withContextFixture(async ({ directory, session }) => {
      const space = putWorkspace(session, { type: "worktree", directory })
      Database.syncDb().update(workspace).set({ config: "{" }).where(eq(workspace.id, space.id)).run()
      const request = contextRequest("/path", directory, space.id)
      await expect(ServerRouter.context(request)).rejects.toBeInstanceOf(SyntaxError)
      const response = await Server.fetch(request)
      expect(response.status).toBe(500)
      expect(await response.json()).toMatchObject({ name: "Unknown" })
    })
  })

  it("preserves missing and malformed workspace 404s without falling back to the session", async () => {
    await withContextFixture(async ({ directory, session }) => {
      for (const workspaceID of ["wrk_missing", "invalid"]) {
        const request = contextRequest(`/session/${session.id}`, directory, workspaceID)
        expect(await ServerRouter.context(request)).toEqual({
          directory,
          workspaceID,
          target: undefined,
        })
        const response = await Server.fetch(request)
        expect(response.status).toBe(404)
        expect(await response.text()).toBe(`Workspace not found: ${workspaceID}`)
      }
    })
  })
})
