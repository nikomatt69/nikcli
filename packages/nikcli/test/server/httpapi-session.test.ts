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
  /**
   * `Session.InfoSchema` members are `Schema.optionalKey`, so an unset optional
   * has to leave the key out entirely. The two ways to get this wrong both
   * look fine from the client type: `Schema.optional` would encode a present
   * `undefined` as `null`, and a producer that assigns `undefined` against
   * `optionalKey` fails the encode and answers 400. `toBeUndefined()` catches
   * only the first, so assert on the keys themselves.
   */
  it("omits unset Session.Info optionals instead of sending null", async () => {
    const directory = await makeProjectDir()
    const optionals = [
      "parentID",
      "summary",
      "share",
      "github",
      "worktree",
      "mobile",
      "activeCommand",
      "permission",
      "disabledInstructions",
      "disabledTools",
      "revert",
      "lastModel",
    ]

    const created = (await post("/session", directory, {})) as Record<string, unknown>
    expect(Object.keys(created)).not.toContain("parentID")
    for (const key of optionals) expect(created).not.toHaveProperty(key)
    expect(Object.keys(created.time as object)).not.toContain("archived")

    const fetched = (await request(`/session/${created.id as string}`, directory)) as Record<string, unknown>
    for (const key of optionals) expect(fetched).not.toHaveProperty(key)

    const [listed] = (await request("/session", directory)) as Record<string, unknown>[]
    for (const key of optionals) expect(listed).not.toHaveProperty(key)

    // Renaming touches the session through the update path, which clones the
    // stored object before the editor runs.
    const updated = (await patch(`/session/${created.id as string}`, directory, { title: "renamed" })) as Record<
      string,
      unknown
    >
    expect(updated.title).toBe("renamed")
    for (const key of optionals) expect(updated).not.toHaveProperty(key)

    // A child session sets parentID and nothing else.
    const child = (await post("/session", directory, { parentID: created.id })) as Record<string, unknown>
    expect(child.parentID).toBe(created.id)
    for (const key of optionals.filter((k) => k !== "parentID")) expect(child).not.toHaveProperty(key)
  })

  /**
   * `ContextBreakdown.model` and each source's `detail` are `optionalKey`, and
   * the producer used to write `undefined` for both — the encode only survived
   * because the handler round-tripped through `jsonSafe`. Without a route test
   * this endpoint had no coverage at all.
   */
  it("serves the context breakdown with unset optionals omitted", async () => {
    const directory = await makeProjectDir()
    const created = (await post("/session", directory, {})) as { id: string }

    const breakdown = (await request(`/session/${created.id}/context`, directory)) as {
      model?: unknown
      sources: { id: string; detail?: unknown }[]
      estimatedTotal: number
    }

    expect(Array.isArray(breakdown.sources)).toBe(true)
    expect(typeof breakdown.estimatedTotal).toBe("number")
    if (!("model" in breakdown)) expect(breakdown.model).toBeUndefined()
    for (const source of breakdown.sources) {
      if ("detail" in source) expect(source.detail).not.toBeNull()
    }
  })

  /**
   * A running monitor has no `exitCode`, `signal` or `time.completed` yet, and
   * no `partID` until a tool part matches. Those are `optionalKey` on
   * `Monitor.RecordSchema`, and the exit handler used to clear `exitCode` and
   * `signal` by assigning `undefined` — which is a 400, not an omitted field,
   * once the handler stops round-tripping through `jsonSafe`.
   */
  it("serves a running monitor record with unset optionals omitted", async () => {
    const directory = await makeProjectDir()
    const created = (await post("/session", directory, {})) as { id: string }

    const { Monitor } = await import("@/monitor/manager")
    const record = await Instance.provide({
      directory,
      fn: () =>
        Monitor.start({
          sessionID: created.id,
          messageID: "msg_monitor_test",
          callID: "call_monitor_test",
          title: "sleeper",
          command: "sleep 30",
          cwd: directory,
          agent: "build",
          wake: false,
        }),
    })

    const fetched = (await request(`/session/${created.id}/monitor/${record.id}`, directory)) as Record<string, unknown>
    expect(fetched.status).toBe("running")
    expect(typeof fetched.pid).toBe("number")
    for (const key of ["exitCode", "signal", "partID", "timeoutMs"]) expect(fetched).not.toHaveProperty(key)
    expect(fetched.time as object).not.toHaveProperty("completed")

    const cancelled = (await post(`/session/${created.id}/monitor/${record.id}/cancel`, directory, {})) as Record<
      string,
      unknown
    >
    expect(cancelled.status).toBe("cancelled")
    expect(cancelled).not.toHaveProperty("partID")
  })

  /**
   * `SessionGoalState.tokenBudget` is the one optional on the goal state, and
   * a goal set without a budget must omit the key rather than send `null`.
   */
  it("serves a goal without a budget as an absent key", async () => {
    const directory = await makeProjectDir()
    const created = (await post("/session", directory, {})) as { id: string }

    const empty = await request(`/session/${created.id}/goal`, directory)
    expect(empty).toBeNull()

    const { Effect } = await import("effect")
    const { runPromiseWithLayer } = await import("@/effect")
    const { SessionGoal } = await import("@/session/goal")
    await Instance.provide({
      directory,
      fn: () =>
        runPromiseWithLayer(
          SessionGoal.defaultLayer,
          Effect.gen(function* () {
            const goal = yield* SessionGoal.Service
            return yield* goal.set(created.id, "ship the slice")
          }),
        ),
    })

    const state = (await request(`/session/${created.id}/goal`, directory)) as Record<string, unknown>
    expect(state.objective).toBe("ship the slice")
    expect(state).not.toHaveProperty("tokenBudget")
  })

  /**
   * The queued prompt's `data` carries nine optionals (`agent`, `model`,
   * `system`, …). A queue entry made from a bare prompt sets none of them, and
   * the pending routes hand the decoded row straight to the encoder. Only the
   * list route is exercised: `POST .../steer` promotes the entry and starts a
   * real prompt loop, which in this environment dies on model resolution and
   * surfaces as an unhandled error between tests.
   */
  it("serves a queued pending input with unset optionals omitted", async () => {
    const directory = await makeProjectDir()
    const created = (await post("/session", directory, {})) as { id: string }

    const { SessionPending } = await import("@/session/pending")
    const inserted = await Instance.provide({
      directory,
      fn: async () =>
        SessionPending.insert({
          sessionID: created.id,
          messageID: "msg_pending_test",
          delivery: "queue",
          data: JSON.stringify({
            sessionID: created.id,
            parts: [{ type: "text", text: "queued while busy" }],
          }),
        }),
    })

    const [entry] = (await request(`/session/${created.id}/pending`, directory)) as {
      id: string
      data: Record<string, unknown>
    }[]
    expect(entry!.id).toBe(inserted.id)
    for (const key of ["agent", "model", "system", "variant", "noReply", "tools", "format", "delivery"]) {
      expect(entry!.data).not.toHaveProperty(key)
    }
  })

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

  it("returns the declared 404 body for a missing session on revert", async () => {
    const directory = await makeProjectDir()
    await request("/session", directory)

    const url = new URL("/session/ses_does_not_exist/revert", "http://nikcli.local")
    url.searchParams.set("directory", directory)
    const response = await Server.fetch(
      new Request(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageID: "msg_does_not_exist" }),
      }),
    )
    expect(response.status).toBe(404)
    const body = (await response.json()) as { name: string }
    expect(body.name).toBe("NotFoundError")
  })

  it("returns the declared 404 body for a missing session on diff", async () => {
    const directory = await makeProjectDir()
    await request("/session", directory)

    const url = new URL("/session/ses_does_not_exist/diff", "http://nikcli.local")
    url.searchParams.set("directory", directory)
    url.searchParams.set("messageID", "msg_does_not_exist")
    const response = await Server.fetch(new Request(url))
    expect(response.status).toBe(404)
    const body = (await response.json()) as { name: string }
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
