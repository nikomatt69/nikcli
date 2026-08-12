import { preserveTestEnv } from "../helpers/env"
import { removeTestDir } from "../helpers/fs"
import { afterAll, afterEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-session-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
process.env.XDG_DATA_HOME = path.join(testHome, "data")
process.env.XDG_CACHE_HOME = path.join(testHome, "cache")
process.env.XDG_CONFIG_HOME = path.join(testHome, "config")
process.env.XDG_STATE_HOME = path.join(testHome, "state")

preserveTestEnv([
  "NIKCLI_TEST_HOME",
  "NIKCLI_DISABLE_PROJECT_CONFIG",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
])

const { Instance } = await import("@/project/instance")
const { HttpApiBridge } = await import("@/server/httpapi/bridge")
const { Server } = await import("@/server/server")
const { MessageRepo } = await import("@/session/message-repo")

const projectDirs: string[] = []

async function git(directory: string, ...args: string[]) {
  const process = Bun.spawn(["git", ...args], { cwd: directory, stdout: "pipe", stderr: "pipe" })
  const [code, stderr] = await Promise.all([process.exited, new Response(process.stderr).text()])
  if (code !== 0) throw new Error(stderr)
}

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-session-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

async function request(pathname: string, directory: string, params: Record<string, string> = {}) {
  const url = new URL(pathname, "http://nikcli.local")
  url.searchParams.set("directory", directory)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  const response = await Server.fetch(new Request(url))
  if (response.status !== 200) {
    throw new Error(`Expected ${pathname} to return 200, got ${response.status}: ${await response.text()}`)
  }
  return response.json()
}

async function post(pathname: string, directory: string, body: unknown) {
  return jsonRequest("POST", pathname, directory, body)
}

async function patch(pathname: string, directory: string, body: unknown) {
  return jsonRequest("PATCH", pathname, directory, body)
}

async function remove(pathname: string, directory: string) {
  return jsonRequest("DELETE", pathname, directory)
}

/**
 * Lists sessions the way an SDK client does: the directory rides on
 * `x-nikcli-directory` (instance selection) instead of the `directory` query
 * parameter (a per-directory filter), so the result is the whole project the
 * directory belongs to. This is what the TUI project/global scope switch uses.
 */
async function listByInstance(directory: string, params: Record<string, string> = {}) {
  const url = new URL("/session", "http://nikcli.local")
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  const response = await Server.fetch(new Request(url, { headers: { "x-nikcli-directory": directory } }))
  if (response.status !== 200) {
    throw new Error(`Expected /session to return 200, got ${response.status}: ${await response.text()}`)
  }
  return (await response.json()) as { id: string; title: string; directory: string }[]
}

async function jsonRequest(method: string, pathname: string, directory: string, body?: unknown) {
  const url = new URL(pathname, "http://nikcli.local")
  url.searchParams.set("directory", directory)
  const headers = new Headers()
  if (body !== undefined) headers.set("content-type", "application/json")
  const response = await Server.fetch(
    new Request(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
  if (response.status !== 200) {
    throw new Error(`Expected ${method} ${pathname} to return 200, got ${response.status}: ${await response.text()}`)
  }
  return response.json()
}

describe("Session HttpApi bridge", () => {
  it("creates a session without a request body for legacy SDK compatibility", async () => {
    const directory = await makeProjectDir()
    const created = (await jsonRequest("POST", "/session", directory)) as {
      id: string
      directory: string
    }

    expect(created.id).toStartWith("ses_")
    expect(created.directory).toBe(directory)
  })

  it("serves session list and status routes", async () => {
    const directory = await makeProjectDir()
    const created = (await post("/session", directory, {
      title: "Bridge session",
    })) as { id: string; title: string }
    const deleted = (await post("/session", directory, {
      title: "Delete me",
    })) as { id: string; title: string }

    expect(HttpApiBridge.supports("/session", "POST")).toBe(true)
    expect(HttpApiBridge.supports("/session", "GET")).toBe(true)
    expect(HttpApiBridge.supports("/session/status", "GET")).toBe(true)
    expect(HttpApiBridge.supports(`/session/${created.id}`, "GET")).toBe(true)
    expect(HttpApiBridge.supports(`/session/${created.id}`, "PATCH")).toBe(true)
    expect(HttpApiBridge.supports(`/session/${deleted.id}`, "DELETE")).toBe(true)
    expect(HttpApiBridge.supports(`/session/${created.id}/children`, "GET")).toBe(true)
    expect(HttpApiBridge.supports(`/session/${created.id}/fork`, "POST")).toBe(true)
    expect(HttpApiBridge.supports(`/session/${created.id}/abort`, "POST")).toBe(true)
    expect(HttpApiBridge.supports(`/session/${created.id}/revert`, "POST")).toBe(true)
    expect(HttpApiBridge.supports(`/session/${created.id}/unrevert`, "POST")).toBe(true)
    expect(HttpApiBridge.supports(`/session/${created.id}/diff`, "GET")).toBe(true)
    expect(HttpApiBridge.supports(`/session/${created.id}/message`, "GET")).toBe(true)
    expect(HttpApiBridge.supports(`/session/${created.id}/message/msg_httpapi`, "GET")).toBe(true)
    expect(HttpApiBridge.supports(`/session/${created.id}/message/msg_httpapi`, "DELETE")).toBe(true)
    expect(HttpApiBridge.supports(`/session/${created.id}/message/msg_httpapi/part/prt_httpapi`, "DELETE")).toBe(true)
    expect(HttpApiBridge.supports(`/session/${created.id}/message/msg_httpapi/part/prt_httpapi`, "PATCH")).toBe(true)
    expect(HttpApiBridge.supports(`/session/${created.id}/todo`, "GET")).toBe(true)
    expect(HttpApiBridge.supports(`/session/${created.id}/v2/entries`, "GET")).toBe(true)
    expect(HttpApiBridge.supports(`/session/${created.id}/v2/state`, "GET")).toBe(true)
    expect(HttpApiBridge.supports(`/session/${created.id}/v2/events`, "GET")).toBe(true)

    const v2Entries = (await request(`/session/${created.id}/v2/entries`, directory)) as unknown[]
    expect(Array.isArray(v2Entries)).toBe(true)
    const v2State = (await request(`/session/${created.id}/v2/state`, directory)) as {
      entries: unknown[]
      pending: unknown[]
    }
    expect(v2State).toEqual(
      expect.objectContaining({
        entries: expect.any(Array),
        pending: expect.any(Array),
      }),
    )
    const v2Events = (await request(`/session/${created.id}/v2/events`, directory)) as unknown[]
    expect(Array.isArray(v2Events)).toBe(true)

    const sessions = (await request("/session", directory, {
      roots: "true",
      limit: "10",
    })) as unknown[]
    expect(sessions).toContainEqual(expect.objectContaining({ id: created.id, title: "Bridge session" }))

    const statuses = (await request("/session/status", directory)) as Record<string, unknown>
    expect(statuses).toEqual({})

    const session = (await request(`/session/${created.id}`, directory)) as {
      id: string
      title: string
    }
    expect(session).toEqual(expect.objectContaining({ id: created.id, title: "Bridge session" }))

    const updated = (await patch(`/session/${created.id}`, directory, {
      title: "Updated bridge session",
    })) as {
      id: string
      title: string
    }
    expect(updated).toEqual(
      expect.objectContaining({
        id: created.id,
        title: "Updated bridge session",
      }),
    )

    const removed = (await remove(`/session/${deleted.id}`, directory)) as boolean
    expect(removed).toBe(true)

    const children = (await request(`/session/${created.id}/children`, directory)) as unknown[]
    expect(children).toEqual([])

    const forked = (await post(`/session/${created.id}/fork`, directory, {})) as {
      id: string
      parentID: string
      title: string
    }
    expect(forked).toEqual(expect.objectContaining({ parentID: created.id }))

    const forkedChildren = (await request(`/session/${created.id}/children`, directory)) as unknown[]
    expect(forkedChildren).toContainEqual(expect.objectContaining({ id: forked.id, parentID: created.id }))

    const aborted = (await post(`/session/${created.id}/abort`, directory, {})) as boolean
    expect(aborted).toBe(true)

    const diff = (await request(`/session/${created.id}/diff`, directory)) as unknown[]
    expect(diff).toEqual([])

    const messages = (await request(`/session/${created.id}/message`, directory, { limit: "10" })) as unknown[]
    expect(messages).toEqual([])

    const messageID = "msg_httpapi"
    const partID = "prt_httpapi"
    const message = {
      id: messageID,
      sessionID: created.id,
      role: "user",
      time: { created: Date.now() },
      agent: "general",
      model: { providerID: "openai", modelID: "gpt-5" },
    }
    const part = {
      id: partID,
      sessionID: created.id,
      messageID,
      type: "text",
      text: "hello",
    }
    // message reads go through the SQL repo since the Drizzle adoption, so
    // the fixture must be written there, not into legacy JSON storage
    MessageRepo.upsertMessage(message as never)
    MessageRepo.upsertPart(part as never)

    const single = (await request(`/session/${created.id}/message/${messageID}`, directory)) as {
      info: { id: string }
      parts: Array<{ id: string; text?: string }>
    }
    expect(single.info.id).toBe(messageID)
    expect(single.parts).toContainEqual(expect.objectContaining({ id: partID, text: "hello" }))

    const updatedPart = (await patch(`/session/${created.id}/message/${messageID}/part/${partID}`, directory, {
      ...part,
      text: "updated",
    })) as { id: string; text: string }
    expect(updatedPart).toEqual(expect.objectContaining({ id: partID, text: "updated" }))

    const reverted = (await post(`/session/${created.id}/revert`, directory, {
      messageID,
    })) as {
      id: string
      revert?: { messageID: string }
    }
    expect(reverted).toEqual(
      expect.objectContaining({
        id: created.id,
        revert: expect.objectContaining({ messageID }),
      }),
    )

    const unreverted = (await post(`/session/${created.id}/unrevert`, directory, {})) as {
      id: string
      revert?: unknown
    }
    expect(unreverted).toEqual(expect.objectContaining({ id: created.id }))
    expect(unreverted.revert).toBeUndefined()

    const removedPart = (await remove(
      `/session/${created.id}/message/${messageID}/part/${partID}`,
      directory,
    )) as boolean
    expect(removedPart).toBe(true)

    MessageRepo.upsertPart(part as never)
    const removedMessage = (await remove(`/session/${created.id}/message/${messageID}`, directory)) as boolean
    expect(removedMessage).toBe(true)

    const todos = (await request(`/session/${created.id}/todo`, directory)) as unknown[]
    expect(todos).toEqual([])
  })

  it("separates project sessions from global ones so the TUI can switch scope", async () => {
    const projectDirectory = await makeProjectDir()
    await git(projectDirectory, "init")
    await git(
      projectDirectory,
      "-c",
      "user.email=test@example.com",
      "-c",
      "user.name=Test",
      "commit",
      "--allow-empty",
      "-m",
      "root",
    )
    // No `.git` above a temp dir, so this one belongs to the global project —
    // exactly like the `/` the TUI binds its global-scope client to.
    const globalDirectory = await makeProjectDir()

    const projectSession = (await post("/session", projectDirectory, { title: "Project scope" })) as { id: string }
    const globalSession = (await post("/session", globalDirectory, { title: "Global scope" })) as { id: string }

    const projectScope = await listByInstance(projectDirectory, { roots: "true" })
    expect(projectScope.map((session) => session.id)).toContain(projectSession.id)
    expect(projectScope.map((session) => session.id)).not.toContain(globalSession.id)

    // `/` resolves to the global project, and lists its sessions whatever
    // directory they were started in.
    const globalScope = await listByInstance(path.parse(globalDirectory).root, { roots: "true" })
    expect(globalScope.map((session) => session.id)).toContain(globalSession.id)
    expect(globalScope.map((session) => session.id)).not.toContain(projectSession.id)
  })

  it("returns the declared 404 body for a missing session", async () => {
    const directory = await makeProjectDir()
    // boot the instance so the failure comes from the route, not bootstrap
    await request("/session", directory)

    const url = new URL("/session/ses_does_not_exist", "http://nikcli.local")
    url.searchParams.set("directory", directory)
    const response = await Server.fetch(new Request(url))
    expect(response.status).toBe(404)
    const body = (await response.json()) as {
      name: string
      data: Record<string, unknown>
    }
    expect(body.name).toBe("NotFoundError")
    expect(String(body.data.message)).toContain("ses_does_not_exist")
  })

  it("bridges share/unshare/summarize and returns the declared 404 for a missing session", async () => {
    const directory = await makeProjectDir()
    await request("/session", directory)

    expect(HttpApiBridge.supports("/session/ses_x/share", "POST")).toBe(true)
    expect(HttpApiBridge.supports("/session/ses_x/share", "DELETE")).toBe(true)
    expect(HttpApiBridge.supports("/session/ses_x/summarize", "POST")).toBe(true)

    // summarize hits session.get first — a missing session is the declared 404
    const url = new URL("/session/ses_does_not_exist/summarize", "http://nikcli.local")
    url.searchParams.set("directory", directory)
    const response = await Server.fetch(
      new Request(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerID: "openai", modelID: "gpt-5" }),
      }),
    )
    expect(response.status).toBe(404)
    const body = (await response.json()) as { name: string }
    expect(body.name).toBe("NotFoundError")
  })

  it("returns the declared 404 body for a missing message", async () => {
    const directory = await makeProjectDir()
    const created = (await post("/session", directory, {
      title: "404 message",
    })) as { id: string }

    const url = new URL(`/session/${created.id}/message/msg_does_not_exist`, "http://nikcli.local")
    url.searchParams.set("directory", directory)
    const response = await Server.fetch(new Request(url))
    expect(response.status).toBe(404)
    const body = (await response.json()) as {
      name: string
      data: Record<string, unknown>
    }
    expect(body.name).toBe("NotFoundError")
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
