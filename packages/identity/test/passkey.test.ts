import { afterEach, describe, expect, test } from "bun:test"
import app from "../src/index"
import { memoryD1, type MemoryD1 } from "./support/d1"

type SentEmail = { to: string; subject: string; text: string }

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

function harness() {
  const sent: SentEmail[] = []
  const db = memoryD1()
  const env = {
    ISSUER: "https://auth.nikcli.store",
    AUDIENCE: "nikcli-api",
    EMAIL_SENDER: "auth@nikcli.store",
    GITHUB_CLIENT_ID: "test-client",
    GITHUB_CLIENT_SECRET: "test-secret",
    STATE: fakeState(),
    DB: db,
    EMAIL: {
      async send(message: SentEmail) {
        sent.push(message)
        return { messageId: "test-message" }
      },
    },
  } as unknown as Env

  const fetch = (request: Request) => Promise.resolve(app.fetch(request, env))

  const postForm = (path: string, form: Record<string, string>) =>
    fetch(
      new Request(`https://auth.nikcli.store${path}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": "203.0.113.7" },
        body: new URLSearchParams(form).toString(),
      }),
    )

  const postJSON = (path: string, body: Record<string, unknown>) =>
    fetch(
      new Request(`https://auth.nikcli.store${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7" },
        body: JSON.stringify(body),
      }),
    )

  const get = (path: string) => fetch(new Request(`https://auth.nikcli.store${path}`))

  async function startDevice() {
    const response = await fetch(
      new Request("https://auth.nikcli.store/oauth/device/code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_id: "nikcli", scope: "openid profile email offline_access" }),
      }),
    )
    return (await response.json()) as { device_code: string; user_code: string }
  }

  return { env, sent, db, postForm, postJSON, get, startDevice }
}

function loginStateOf(html: string): string {
  const match = html.match(/name="login_state" value="([^"]+)"/)
  if (!match) throw new Error(`no login_state in page: ${html.slice(0, 200)}`)
  return match[1]!
}

function codeOf(email: SentEmail): string {
  return email.subject.split(" ", 1)[0]!
}

const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"

function authorizePath() {
  const url = new URL("https://auth.nikcli.store/authorize")
  url.searchParams.set("client_id", "nikcli-mobile")
  url.searchParams.set("redirect_uri", "nikcli://auth/callback")
  url.searchParams.set("response_type", "code")
  url.searchParams.set("state", "client-state")
  url.searchParams.set("code_challenge", CHALLENGE)
  url.searchParams.set("code_challenge_method", "S256")
  return url.pathname + url.search
}

async function reachEmailOffer(kit: ReturnType<typeof fixture>, kind: "device" | "authorize" = "device") {
  let loginState: string
  if (kind === "authorize") {
    loginState = loginStateOf(await kit.get(authorizePath()).then((r) => r.text()))
  } else {
    const device = await kit.startDevice()
    const page = await kit.postForm("/device", { user_code: device.user_code, decision: "approve" }).then((r) => r.text())
    loginState = loginStateOf(page)
  }
  await kit.postForm("/login/email/request", { login_state: loginState, email: "user@example.com" })
  const offered = await kit.postForm("/login/email/verify", {
    login_state: loginState,
    code: codeOf(kit.sent[0]!),
  })
  expect(offered.status).toBe(200)
  expect(await offered.text()).toContain("Save a passkey")
  return { loginState }
}

let open: MemoryD1[] = []
afterEach(() => {
  for (const db of open) db.close()
  open = []
})

function fixture() {
  const kit = harness()
  open.push(kit.db)
  return kit
}

describe("passkey authentication options", () => {
  test("returns 400 without login_state or with an expired session", async () => {
    const kit = fixture()
    const missing = await kit.postJSON("/login/passkey/authentication/options", {})
    expect(missing.status).toBe(400)

    const expired = await kit.postJSON("/login/passkey/authentication/options", { login_state: "never-issued" })
    expect(expired.status).toBe(400)
    const body = (await expired.json()) as { error_description?: string }
    expect(body.error_description).toMatch(/session expired/i)
  })

  test("returns 200 with a challenge for a valid login_state", async () => {
    const kit = fixture()
    const loginState = loginStateOf(await kit.get(authorizePath()).then((r) => r.text()))
    const response = await kit.postJSON("/login/passkey/authentication/options", { login_state: loginState })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { challenge?: unknown; rpId?: unknown }
    expect(typeof body.challenge).toBe("string")
    expect((body.challenge as string).length).toBeGreaterThan(8)
    expect(body.rpId).toBe("auth.nikcli.store")
  })
})

describe("passkey skip after first-factor offer", () => {
  test("skip after offer completes a device login", async () => {
    const kit = fixture()
    const { loginState } = await reachEmailOffer(kit, "device")
    const skipped = await kit.postForm("/login/passkey/skip", { login_state: loginState })
    expect(skipped.status).toBe(200)
    expect(await skipped.text()).toContain("Device connected")
  })

  test("skip after offer completes an authorize login", async () => {
    const kit = fixture()
    const { loginState } = await reachEmailOffer(kit, "authorize")
    const skipped = await kit.postForm("/login/passkey/skip", { login_state: loginState })
    expect(skipped.status).toBe(302)
    const location = new URL(skipped.headers.get("Location")!)
    expect(location.protocol).toBe("nikcli:")
    expect(location.searchParams.get("state")).toBe("client-state")
    expect(location.searchParams.get("code")).toBeTruthy()
  })
})

describe("passkey authentication verify", () => {
  test("returns 400 for a junk credential", async () => {
    const kit = fixture()
    const loginState = loginStateOf(await kit.get(authorizePath()).then((r) => r.text()))
    const options = await kit.postJSON("/login/passkey/authentication/options", { login_state: loginState })
    expect(options.status).toBe(200)

    const response = await kit.postJSON("/login/passkey/authentication/verify", {
      login_state: loginState,
      credential: { id: "not-a-real-credential", type: "public-key", response: {} },
    })
    expect(response.status).toBe(400)
  })
})
