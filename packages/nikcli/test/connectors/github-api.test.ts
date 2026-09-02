import { afterEach, describe, expect, it } from "bun:test"
import { GithubApi, GithubApiError } from "@/connectors/api/github"

const originalFetch = globalThis.fetch
const captured: string[] = []

function stubGithub(status: number, body: unknown, statusText = "OK") {
  captured.length = 0
  globalThis.fetch = (async (input: string | URL | Request) => {
    captured.push(String(input))
    return new Response(JSON.stringify(body), {
      status,
      statusText,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch
}

afterEach(() => {
  globalThis.fetch = originalFetch
  captured.length = 0
})

describe("GithubApi.listRepos", () => {
  it("uses affiliation and visibility instead of the deprecated type parameter", async () => {
    stubGithub(200, [])
    await GithubApi.listRepos("token", "all", "updated")
    expect(captured).toHaveLength(1)
    const url = new URL(captured[0]!)
    expect(url.pathname).toBe("/user/repos")
    expect(url.searchParams.get("type")).toBeNull()
    expect(url.searchParams.get("affiliation")).toBe("owner,collaborator,organization_member")
    expect(url.searchParams.get("visibility")).toBe("all")
    expect(url.searchParams.get("sort")).toBe("updated")
  })

  it("maps owner and member filters onto affiliation", async () => {
    stubGithub(200, [])
    await GithubApi.listRepos("token", "owner")
    expect(new URL(captured[0]!).searchParams.get("affiliation")).toBe("owner")

    stubGithub(200, [])
    await GithubApi.listRepos("token", "member", "pushed")
    const url = new URL(captured[0]!)
    expect(url.searchParams.get("affiliation")).toBe("collaborator,organization_member")
    expect(url.searchParams.get("sort")).toBe("pushed")
    expect(url.searchParams.get("type")).toBeNull()
  })

  it("throws GithubApiError when GitHub rejects the request", async () => {
    stubGithub(400, { message: "Bad request" }, "Bad Request")
    try {
      await GithubApi.listRepos("token", "all")
      throw new Error("expected GithubApiError")
    } catch (error) {
      expect(error).toBeInstanceOf(GithubApiError)
      expect((error as GithubApiError).status).toBe(400)
    }
  })
})
