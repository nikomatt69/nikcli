import { describe, expect, test } from "bun:test"
import app from "../src/index"
import { isAllowedRedirect } from "../src/constants"
import { randomDigits, secureEqual, sha256 } from "../src/crypto"

function fakeState() {
  const values = new Map<string, string>()
  return {
    async get(key: string, type?: string) {
      const value = values.get(key) ?? null
      return type === "json" && value ? JSON.parse(value) : value
    },
    async put(key: string, value: string) {
      values.set(key, value)
    },
    async delete(key: string) {
      values.delete(key)
    },
  } as KVNamespace
}

function fakeDb() {
  return {
    prepare(sql: string) {
      let values: unknown[] = []
      return {
        bind(...input: unknown[]) {
          values = input
          return this
        },
        async run() {
          if (!sql.includes("INSERT INTO device_codes")) throw new Error(`Unexpected SQL: ${sql}`)
          expect(values).toHaveLength(9)
          return { success: true, meta: { changes: 1 } }
        },
      }
    },
  } as D1Database
}

function env(): Env {
  const send = async (_message: EmailMessage | Parameters<SendEmail["send"]>[0]) => ({ messageId: "test-message" })
  return {
    ISSUER: "https://auth.nikcli.store",
    AUDIENCE: "nikcli-api",
    EMAIL_SENDER: "auth@nikcli.store",
    GITHUB_CLIENT_ID: "test-client",
    GITHUB_CLIENT_SECRET: "test-secret",
    STATE: fakeState(),
    DB: fakeDb(),
    EMAIL: { send },
  }
}

describe("identity contracts", () => {
  test("publishes OAuth and nikcli discovery", async () => {
    const oauth = await app.fetch(
      new Request("https://auth.nikcli.store/.well-known/oauth-authorization-server"),
      env(),
    )
    expect(oauth.status).toBe(200)
    const metadata = (await oauth.json()) as {
      issuer: string
      code_challenge_methods_supported: string[]
    }
    expect(metadata.issuer).toBe("https://auth.nikcli.store")
    expect(metadata.code_challenge_methods_supported).toEqual(["S256"])

    const nikcli = await app.fetch(new Request("https://auth.nikcli.store/.well-known/nikcli"), env())
    const discovery = (await nikcli.json()) as {
      auth: { command: string[]; env: string }
    }
    expect(discovery.auth.command[0]).toBe("curl")
    expect(discovery.auth.env).toBe("NIKCLI_ACCOUNT_URL")
  })

  test("requires PKCE S256 and registered redirects", async () => {
    const invalid = await app.fetch(
      new Request(
        "https://auth.nikcli.store/authorize?response_type=code&client_id=nikcli-studio&redirect_uri=https%3A%2F%2Fattacker.test%2Fcallback&state=s&code_challenge=x&code_challenge_method=plain",
      ),
      env(),
    )
    expect(invalid.status).toBe(400)

    const verifier = "a".repeat(43)
    const validUrl = new URL("https://auth.nikcli.store/authorize")
    validUrl.search = new URLSearchParams({
      response_type: "code",
      client_id: "nikcli-studio",
      redirect_uri: "https://nikcli.store/dashboard/callback",
      state: "opaque-state",
      code_challenge: verifier,
      code_challenge_method: "S256",
    }).toString()
    const valid = await app.fetch(new Request(validUrl), env())
    expect(valid.status).toBe(200)
    expect(await valid.text()).toContain("Continue with GitHub")
  })

  test("returns the shipped CLI device-code response shape", async () => {
    const response = await app.fetch(
      new Request("https://auth.nikcli.store/oauth/device/code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_id: "nikcli",
          scope: "openid profile email offline_access",
        }),
      }),
      env(),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(typeof body.device_code).toBe("string")
    expect(body.user_code).toMatch(/^\d{4}-\d{4}$/)
    expect(body.verification_url).toBe("https://auth.nikcli.store/device")
    expect(body.interval).toBe(5)
    expect(body.expires_in).toBe(600)
  })
})

describe("identity security helpers", () => {
  test("uses registered exact redirects with safe loopback development", () => {
    expect(isAllowedRedirect("nikcli-desktop", "nikcli://auth/callback")).toBe(true)
    expect(isAllowedRedirect("nikcli-web", "https://attacker.test/user/callback")).toBe(false)
    expect(isAllowedRedirect("nikcli-web", "http://127.0.0.1:4321/user/callback")).toBe(true)
  })

  test("generates unbiased decimal codes and compares fixed hashes", async () => {
    expect(randomDigits(64)).toMatch(/^\d{64}$/)
    const hash = await sha256("value")
    expect(await secureEqual(hash, hash)).toBe(true)
    expect(await secureEqual(hash, await sha256("other"))).toBe(false)
  })
})
