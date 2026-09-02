import { describe, expect, test } from "bun:test"
import { createNikcliClient } from "@nikcli-ai/sdk/httpapi"

function recordingFetch(requests: Request[]): typeof globalThis.fetch {
  return Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init))
      return Response.json({})
    },
    { preconnect: () => undefined },
  )
}

describe("generated HttpApi compatibility client", () => {
  test("exposes endpoints that the hand-maintained view omitted", async () => {
    const requests: Request[] = []
    const client = createNikcliClient({
      baseUrl: "http://localhost:4096",
      fetch: recordingFetch(requests),
    })

    await client.getConfigProfiles()
    await client.mobile.mission.list()
    await client.project.directory.list({ projectID: "project-1" })

    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/config/profiles",
      "/mobile/missions",
      "/project/project-1/directory",
    ])
  })

  test("keeps endpoint-owned directories separate from instance selection", async () => {
    const requests: Request[] = []
    const client = createNikcliClient({
      baseUrl: "http://localhost:4096",
      fetch: recordingFetch(requests),
    })

    await client.mobile.worktree.remove({ directory: "/worktree", force: true }, { directory: "/instance" })
    await client.session.get({
      sessionID: "session-1",
      directory: "/instance",
    })

    expect(requests).toHaveLength(2)
    const [worktree, session] = requests
    if (worktree === undefined || session === undefined) {
      throw new Error("expected both compatibility requests")
    }
    expect(await worktree.json()).toEqual({
      directory: "/worktree",
      force: true,
    })
    expect(worktree.headers.get("x-nikcli-directory")).toBe("/instance")
    expect(new URL(session.url).pathname).toBe("/session/session-1")
    expect(session.headers.get("x-nikcli-directory")).toBe("/instance")
  })
})
