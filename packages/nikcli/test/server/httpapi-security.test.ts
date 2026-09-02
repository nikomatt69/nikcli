import { preserveTestEnv } from "../helpers/env"
import { removeTestDir } from "../helpers/fs"
import { afterAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-security-home-"))
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
const { Auth } = await import("@/server/httpapi/auth")

type Operation = { readonly security?: ReadonlyArray<Record<string, unknown>> }

const spec = OpenApi.fromApi(PublicApi as never) as unknown as {
  components: { securitySchemes: Record<string, unknown> }
  paths: Record<string, Record<string, Operation>>
}

function operations() {
  const rows: { method: string; path: string; secured: boolean }[] = []
  for (const [pathname, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      rows.push({
        method: method.toUpperCase(),
        path: pathname,
        // `security` is initialised to `[]` for every operation, so presence
        // proves nothing — only a non-empty array means the operation
        // declares a scheme.
        secured: Array.isArray(operation.security) && operation.security.length > 0,
      })
    }
  }
  return rows
}

afterAll(async () => {
  await removeTestDir(testHome)
})

/**
 * H8 put authentication on the contract. These assertions are what stops the
 * contract from drifting away from what the server actually enforces — an
 * operation that claims a scheme it does not apply, or applies one it does not
 * claim, is worse than having no declaration at all.
 */
describe("HttpApi security contract", () => {
  it("declares every credential source the server accepts", () => {
    expect(spec.components.securitySchemes).toEqual({
      bearerAuth: { type: "http", scheme: "Bearer" },
      auth_token: { type: "apiKey", name: "token", in: "query" },
      basicAuth: { type: "http", scheme: "basic" },
    })
  })

  it("leaves exactly the unauthenticated operations without security", () => {
    const open = operations()
      .filter((row) => !row.secured)
      .map((row) => `${row.method} ${row.path}`)
      .sort()

    // Two sources of "reachable without credentials", and both are here:
    // `Auth.isPublicPath` (health probe, browser sign-in, account creation)
    // and `PublicRoutes.publicRequest`, which answers the share routes ahead
    // of authentication entirely.
    expect(open).toEqual([
      "GET /account",
      "GET /api/share/{shareID}",
      "GET /api/share/{shareID}/data",
      "GET /global/health",
      "GET /s/{shareID}",
      "GET /share/{shareID}",
      "POST /account/login",
      "POST /account/login/complete",
      "POST /user/login",
      "POST /user/register",
    ])
  })

  it("secures every other operation with all three schemes", () => {
    const secured = operations().filter((row) => row.secured)
    expect(secured.length).toBeGreaterThan(300)
    for (const [pathname, methods] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        if (!Array.isArray(operation.security) || operation.security.length === 0) continue
        expect(operation.security, `${method.toUpperCase()} ${pathname}`).toEqual([
          { bearerAuth: [] },
          { auth_token: [] },
          { basicAuth: [] },
        ])
      }
    }
  })

  /**
   * The middleware enforces on its own, without consulting `isPublicPath`. So
   * an operation that the router waves through as public while its group
   * declares security would answer 401 instead of running. No such operation
   * exists — this is what keeps it that way.
   */
  it("never declares security on an operation the router treats as public", () => {
    const conflicts = operations()
      .filter((row) => row.secured)
      // The OpenAPI template (`/session/{id}`) is not a concrete path, but
      // every path in `isPublicPath` is literal, so comparing the template
      // directly is exact for the ones that matter.
      .filter((row) => Auth.isPublicPath(row.method, row.path))
      .map((row) => `${row.method} ${row.path}`)

    expect(conflicts).toEqual([])
  })
})
