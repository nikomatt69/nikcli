import { preserveTestEnv } from "../helpers/env"
import { removeTestDir } from "../helpers/fs"
import { afterAll, afterEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-bridge-401-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

preserveTestEnv(["NIKCLI_TEST_HOME", "NIKCLI_DISABLE_PROJECT_CONFIG"])

const { Option } = await import("effect")
const { Instance } = await import("@/project/instance")
const { HttpApiBridge } = await import("@/server/httpapi/bridge")
const { Server } = await import("@/server/server")
const { Auth } = await import("@/server/httpapi/auth")
const { MobileAuth } = await import("@/mobile/auth")

const projectDirs: string[] = []

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-bridge-401-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

async function bridgeRequest(pathname: string, directory: string, init?: RequestInit) {
  const url = new URL(pathname, "http://nikcli.local")
  url.searchParams.set("directory", directory)
  return Instance.provide({
    directory,
    fn: () => HttpApiBridge.handle(new Request(url, init)),
  })
}

async function serverRequest(pathname: string, directory: string, init?: RequestInit) {
  const url = new URL(pathname, "http://nikcli.local")
  url.searchParams.set("directory", directory)
  return Server.fetch(new Request(url, init))
}

/**
 * Request-level basic-auth coverage. `Flag.NIKCLI_SERVER_PASSWORD` captures
 * `process.env["NIKCLI_SERVER_PASSWORD"]` at module-load time, so the
 * production code path cannot be flipped from a test. `HttpApiBridge.overrideAuth`
 * provides a one-line seam into the bridge's `handle()` so these three tests
 * exercise the actual auth path (the in-process `Auth.matchesBasicAuth`
 * helper is covered separately by `httpapi-bridge-auth.test.ts`).
 *
 * The override is module-level — every test must reset it in `finally` to
 * prevent request bleed-through.
 */
describe("HttpApiBridge basic-auth shim (Wave 3b request path)", () => {
  it("returns 401 with WWW-Authenticate when password is configured but request lacks credentials", async () => {
    const directory = await makeProjectDir()
    HttpApiBridge.overrideAuth({
      username: "nikcli",
      password: Option.some("swordfish"),
    })
    try {
      const response = await bridgeRequest("/skill", directory)
      expect(response.status).toBe(401)
      expect(response.headers.get("www-authenticate")).toContain("Basic")
      const body = await response.text()
      expect(body).toBe("Unauthorized")
    } finally {
      HttpApiBridge.overrideAuth(null)
    }
  })

  it("accepts matching basic-auth header and does not 401", async () => {
    const directory = await makeProjectDir()
    HttpApiBridge.overrideAuth({
      username: "nikcli",
      password: Option.some("swordfish"),
    })
    try {
      const valid = `Basic ${Buffer.from("nikcli:swordfish").toString("base64")}`
      const response = await bridgeRequest("/skill", directory, {
        headers: { authorization: valid },
      })
      // The skill list returns 200 in any direction; we only assert
      // that the auth shim did not fire (i.e., the status is not 401).
      expect(response.status).not.toBe(401)
    } finally {
      HttpApiBridge.overrideAuth(null)
    }
  })

  it("passes through when password is Option.none (loopback dev mode)", async () => {
    const directory = await makeProjectDir()
    HttpApiBridge.overrideAuth({
      username: "nikcli",
      password: Option.none(),
    })
    try {
      const response = await bridgeRequest("/skill", directory)
      expect(response.status).not.toBe(401)
    } finally {
      HttpApiBridge.overrideAuth(null)
    }
  })

  it("Auth.extractQueryToken still works under an active override (auth_token security scheme)", () => {
    HttpApiBridge.overrideAuth({
      username: "nikcli",
      password: Option.some("swordfish"),
    })
    try {
      const url = new URL("http://nikcli.local/sync/start?token=abc123")
      expect(Auth.extractQueryToken(url)).toBe("abc123")
    } finally {
      HttpApiBridge.overrideAuth(null)
    }
  })

  /**
   * `WorkspaceServer` serves a workspace sandbox on its own `Bun.serve`, does
   * no authentication of its own, and passes `upstreamAuthVerified: true`.
   * When H8 put the security middleware on the contract, that middleware would
   * have started authenticating those requests and rejected every one of them
   * on a server with a password configured. The bridge marks the request as
   * settled instead, and this is what keeps it settled.
   */
  it("does not authenticate a request an upstream host already vouched for", async () => {
    const directory = await makeProjectDir()
    HttpApiBridge.overrideAuth({
      username: "nikcli",
      password: Option.some("swordfish"),
    })
    try {
      const url = new URL("/skill", "http://nikcli.local")
      url.searchParams.set("directory", directory)
      const response = await Instance.provide({
        directory,
        fn: () => HttpApiBridge.handle(new Request(url), { upstreamAuthVerified: true }),
      })
      expect(response.status).not.toBe(401)
    } finally {
      HttpApiBridge.overrideAuth(null)
    }
  })

  it("does not re-challenge a mobile bearer token already verified by Hono", async () => {
    const directory = await makeProjectDir()
    const created = await MobileAuth.create({ name: "bridge-mobile-test" })
    HttpApiBridge.overrideAuth({
      username: "nikcli",
      password: Option.some("swordfish"),
    })
    try {
      const response = await serverRequest("/skill", directory, {
        headers: { authorization: `Bearer ${created.token}` },
      })
      expect(response.status).not.toBe(401)
    } finally {
      HttpApiBridge.overrideAuth(null)
      await MobileAuth.remove(created.info.id)
    }
  })
})

afterEach(async () => {
  HttpApiBridge.overrideAuth(null)
  await Instance.disposeAll().catch(() => undefined)
})

afterAll(async () => {
  HttpApiBridge.overrideAuth(null)
  await Instance.disposeAll().catch(() => undefined)
  await Promise.all(projectDirs.map((dir) => removeTestDir(dir)))
  await removeTestDir(testHome)
})
