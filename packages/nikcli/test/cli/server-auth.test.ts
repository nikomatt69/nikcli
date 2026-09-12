import { preserveTestEnv } from "../helpers/env"
import { describe, expect, it } from "bun:test"

// The Flag values are module-load constants, so the environment has to be in
// place before `@/cli/server-auth` is imported below.
process.env.NIKCLI_SERVER_USERNAME = "operator"
process.env.NIKCLI_SERVER_PASSWORD = "hunter2"

preserveTestEnv(["NIKCLI_SERVER_USERNAME", "NIKCLI_SERVER_PASSWORD"])

const { authorizedFetch, serverAuthorizationHeader } = await import("@/cli/server-auth")

function capturingFetch() {
  const seen: Request[] = []
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Request(input, init))
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
  }) as typeof globalThis.fetch
  return { fetch, seen }
}

describe("serverAuthorizationHeader", () => {
  it("presents the configured credentials as basic auth", () => {
    expect(serverAuthorizationHeader()).toBe(`Basic ${btoa("operator:hunter2")}`)
  })
})

describe("authorizedFetch", () => {
  it("authenticates a request that carries no credentials", async () => {
    const base = capturingFetch()
    await authorizedFetch(base.fetch)("http://127.0.0.1:49374/config/providers")

    expect(base.seen).toHaveLength(1)
    expect(base.seen[0]?.headers.get("Authorization")).toBe(`Basic ${btoa("operator:hunter2")}`)
  })

  it("leaves credentials the caller already set alone", async () => {
    const base = capturingFetch()
    await authorizedFetch(base.fetch)("http://127.0.0.1:49374/config/providers", {
      headers: { Authorization: "Bearer caller-token" },
    })

    expect(base.seen[0]?.headers.get("Authorization")).toBe("Bearer caller-token")
  })
})
