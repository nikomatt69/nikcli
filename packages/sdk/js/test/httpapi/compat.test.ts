import { describe, expect, test } from "bun:test"
import { createNikcliClient } from "../../src/httpapi/client.js"

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  })

const asFetch = (
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): typeof globalThis.fetch => Object.assign(handler, { preconnect() {} })

describe("HTTP compatibility adapter", () => {
  test("forwards inline selectors without leaking them into endpoint input", async () => {
    const requests: Array<{ url: URL; headers: Headers }> = []
    const client = createNikcliClient({
      baseUrl: "http://nikcli.test",
      fetch: asFetch(async (input, init) => {
        requests.push({
          url: new URL(input.toString()),
          headers: new Headers(init?.headers),
        })
        return json({ id: "ses_test" })
      }),
    })

    await client.session.get({
      sessionID: "ses_test",
      directory: "/inline",
      workspace: "workspace-inline",
    })

    expect(requests[0]?.url.pathname).toBe("/session/ses_test")
    expect(requests[0]?.url.search).toBe("")
    expect(requests[0]?.headers.get("x-nikcli-directory")).toBe("/inline")
    expect(requests[0]?.headers.get("x-nikcli-workspace")).toBe("workspace-inline")
  })

  test("keeps resultAt selector fields while options select the instance", async () => {
    let request: { url: URL; headers: Headers } | undefined
    const client = createNikcliClient({
      baseUrl: "http://nikcli.test",
      fetch: asFetch(async (input, init) => {
        request = {
          url: new URL(input.toString()),
          headers: new Headers(init?.headers),
        }
        return json([])
      }),
    })

    await client.session.list(
      { directory: "/listed", search: "needle" },
      { directory: "/instance", workspace: "workspace-option" },
    )

    expect(request?.url.searchParams.get("directory")).toBe("/listed")
    expect(request?.url.searchParams.get("search")).toBe("needle")
    expect(request?.headers.get("x-nikcli-directory")).toBe("/instance")
    expect(request?.headers.get("x-nikcli-workspace")).toBe("workspace-option")
  })

  test("forwards selectors to input and inputless streams", async () => {
    const requests: Array<{ url: URL; headers: Headers }> = []
    const client = createNikcliClient({
      baseUrl: "http://nikcli.test",
      fetch: asFetch(async (input, init) => {
        requests.push({
          url: new URL(input.toString()),
          headers: new Headers(init?.headers),
        })
        return new Response('data: {"kind":"ready"}\n\n', {
          headers: { "content-type": "text/event-stream" },
        })
      }),
    })

    const event = await client.event.subscribe({ directory: "/events" })
    expect(await Array.fromAsync(event.stream)).toEqual([{ kind: "ready" }])
    const session = await client.mobile.session.stream({
      sessionID: "ses_stream",
      directory: "/session-stream",
    })
    expect(await Array.fromAsync(session.stream)).toEqual([{ kind: "ready" }])

    expect(requests[0]?.headers.get("x-nikcli-directory")).toBe("/events")
    expect(requests[1]?.url.pathname).toBe("/mobile/session/ses_stream/stream")
    expect(requests[1]?.headers.get("x-nikcli-directory")).toBe("/session-stream")
  })

  test("settles errors and honors default and per-call throwOnError", async () => {
    const fetch = asFetch(async () => {
      throw new Error("offline")
    })
    const settled = createNikcliClient({
      baseUrl: "http://nikcli.test",
      fetch,
    })
    const result = await settled.global.health()
    expect(result.data).toBeUndefined()
    expect(result.error).toHaveProperty("name", "ClientError")

    await expect(settled.global.health({ throwOnError: true })).rejects.toHaveProperty("name", "ClientError")
    const throwing = createNikcliClient({
      baseUrl: "http://nikcli.test",
      fetch,
      throwOnError: true,
    })
    await expect(throwing.global.health()).rejects.toHaveProperty("name", "ClientError")
    expect((await throwing.global.health({ throwOnError: false })).error).toHaveProperty("name", "ClientError")
  })

  test("includes unexpected response status when settling", async () => {
    const client = createNikcliClient({
      baseUrl: "http://nikcli.test",
      fetch: asFetch(async () => json({ message: "unavailable" }, 503)),
    })

    const result = await client.global.health()
    expect(result.response).toEqual({ status: 503 })
  })
})
