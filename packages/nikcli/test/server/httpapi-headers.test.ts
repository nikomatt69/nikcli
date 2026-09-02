import { preserveTestEnv } from "../helpers/env"
import { afterAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-headers-home-"))
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

const { OpenApi } = await import("effect/unstable/httpapi")
const { PublicApi } = await import("@/server/httpapi/public")
const { createNikcliClient } = await import("@nikcli-ai/sdk/httpapi")

type Operation = {
  readonly responses?: Record<
    string,
    {
      readonly headers?: Record<string, unknown>
    }
  >
}

const spec = OpenApi.fromApi(PublicApi) as {
  paths: Record<string, Record<string, Operation>>
}

function responseHeaders(pathname: string, method: string, status: string) {
  return spec.paths[pathname]?.[method]?.responses?.[status]?.headers ?? {}
}

afterAll(async () => {
  await fs.rm(testHome, { recursive: true, force: true })
})

describe("H9 declared response headers", () => {
  it("puts location on the share short redirect", () => {
    expect(responseHeaders("/s/{shareID}", "get", "308")).toHaveProperty("location")
  })

  it("puts retry-after on the sync push 429", () => {
    expect(responseHeaders("/sync/event", "post", "429")).toHaveProperty("retry-after")
  })

  it("puts www-authenticate on the documented 401", () => {
    expect(responseHeaders("/sync/event", "post", "401")).toHaveProperty("www-authenticate")
  })

  it("round-trips a declared location header through the generated client", async () => {
    const requests: Request[] = []
    const client = createNikcliClient({
      baseUrl: "http://nikcli.local",
      fetch: Object.assign(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          requests.push(new Request(input, init))
          return new Response(null, {
            status: 308,
            headers: { location: "/share/abc" },
          })
        },
        { preconnect: () => undefined },
      ),
    })

    const result = await client.getSShareId({ shareID: "abc" })
    expect(requests).toHaveLength(1)
    expect(new URL(requests[0]!.url).pathname).toBe("/s/abc")
    expect(result.error).toBeUndefined()
    expect(result.data).toEqual({ body: undefined, headers: { location: "/share/abc" } })
  })
})
