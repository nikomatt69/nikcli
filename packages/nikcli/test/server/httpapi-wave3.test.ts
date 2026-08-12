import { preserveTestEnv } from "../helpers/env"
import { removeTestDir } from "../helpers/fs"
import { afterAll, afterEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-wave3-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
process.env.NIKCLI_EXPERIMENTAL_HTTPAPI = "1"

preserveTestEnv(["NIKCLI_TEST_HOME", "NIKCLI_DISABLE_PROJECT_CONFIG", "NIKCLI_EXPERIMENTAL_HTTPAPI"])

const { Instance } = await import("@/project/instance")
const { HttpApiBridge } = await import("@/server/httpapi/bridge")
const { Server } = await import("@/server/server")

const projectDirs: string[] = []

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-wave3-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

async function request(pathname: string, directory: string, init?: RequestInit) {
  const url = new URL(pathname, "http://nikcli.local")
  url.searchParams.set("directory", directory)
  return Server.App().fetch(new Request(url, init))
}

async function userRequest(pathname: string, init?: RequestInit) {
  const url = new URL(pathname, "http://nikcli.local")
  return Server.App().fetch(new Request(url, init))
}

describe("Brain HttpApi", () => {
  it("advertises brain routes", () => {
    expect(HttpApiBridge.supports("/brain", "GET")).toBe(true)
    expect(HttpApiBridge.supports("/brain/trigger", "POST")).toBe(true)
  })

  it("serves GET /brain status", async () => {
    const directory = await makeProjectDir()
    const response = await request("/brain", directory)
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      enabled: boolean
      minHours: number
      shouldTrigger: boolean
    }
    expect(typeof body.enabled).toBe("boolean")
    expect(typeof body.minHours).toBe("number")
    expect(typeof body.shouldTrigger).toBe("boolean")
  })

  it("serves POST /brain/trigger (threshold path, no force)", async () => {
    const directory = await makeProjectDir()
    const response = await request("/brain/trigger", directory, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { success: boolean }
    expect(typeof body.success).toBe("boolean")
  })
})

describe("Connectors HttpApi", () => {
  it("advertises connectors routes", () => {
    expect(HttpApiBridge.supports("/connectors", "GET")).toBe(true)
    expect(HttpApiBridge.supports("/connectors/slack/auth", "POST")).toBe(true)
    expect(HttpApiBridge.supports("/connectors/slack/auth", "DELETE")).toBe(true)
    expect(HttpApiBridge.supports("/connectors/invalidate", "POST")).toBe(true)
  })

  it("serves GET /connectors status", async () => {
    const directory = await makeProjectDir()
    const response = await request("/connectors", directory)
    expect(response.status).toBe(200)
    expect(typeof (await response.json())).toBe("object")
  })

  it("rejects credentials without any field with the legacy 400 body", async () => {
    const directory = await makeProjectDir()
    const response = await request("/connectors/slack/auth", directory, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as { name: string }
    expect(body.name).toBe("ValidationError")
  })

  it("stores and removes connector credentials", async () => {
    const directory = await makeProjectDir()
    const stored = await request("/connectors/testsvc/auth", directory, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "tok_123" }),
    })
    expect(stored.status).toBe(200)
    expect(await stored.json()).toEqual({ success: true })

    const removed = await request("/connectors/testsvc/auth", directory, {
      method: "DELETE",
    })
    expect(removed.status).toBe(200)
    expect(await removed.json()).toEqual({ success: true })
  })

  it("invalidates connector caches", async () => {
    const directory = await makeProjectDir()
    const response = await request("/connectors/invalidate", directory, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
  })
})

describe("Users raw HTTP (instance-less bridge branch)", () => {
  it("advertises user routes on the instance-less branch only", () => {
    expect(HttpApiBridge.supportsGlobal("/user/status", "GET")).toBe(true)
    expect(HttpApiBridge.supportsGlobal("/user/register", "POST")).toBe(true)
    expect(HttpApiBridge.supportsGlobal("/user/login", "POST")).toBe(true)
    expect(HttpApiBridge.supportsGlobal("/user/u_1", "PATCH")).toBe(true)
    expect(HttpApiBridge.supportsGlobal("/user/u_1", "DELETE")).toBe(true)
    expect(HttpApiBridge.supports("/user/status", "GET")).toBe(false)
  })

  it("register/login/me/logout round trip", async () => {
    const status = await userRequest("/user/status")
    expect(status.status).toBe(200)
    expect(await status.json()).toEqual({ hasUsers: false })

    const badRegister = await userRequest("/user/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "ab", email: "not-an-email", password: "short" }),
    })
    expect(badRegister.status).toBe(400)

    const register = await userRequest("/user/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "tester",
        email: "tester@example.com",
        password: "Sup3r-secret!",
      }),
    })
    expect(register.status).toBe(201)
    const created = (await register.json()) as {
      token: string
      user: { id: string; email: string }
    }
    expect(created.token.startsWith("nku_")).toBe(true)
    expect(created.user.email).toBe("tester@example.com")

    const badLogin = await userRequest("/user/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "tester@example.com", password: "wrong-pass" }),
    })
    expect(badLogin.status).toBe(401)
    expect(await badLogin.json()).toEqual({ error: "Invalid credentials" })

    const login = await userRequest("/user/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "tester@example.com", password: "Sup3r-secret!" }),
    })
    expect(login.status).toBe(200)
    const { token } = (await login.json()) as { token: string }

    const anonymous = await userRequest("/user/me")
    expect(anonymous.status).toBe(401)

    const me = await userRequest("/user/me", {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(me.status).toBe(200)
    expect(((await me.json()) as { email: string }).email).toBe("tester@example.com")

    const logout = await userRequest("/user/logout", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    })
    expect(logout.status).toBe(200)
    expect(await logout.json()).toEqual({ ok: true })

    const afterLogout = await userRequest("/user/me", {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(afterLogout.status).toBe(401)

    // Second registration without an admin session must be rejected.
    const secondRegister = await userRequest("/user/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "intruder",
        email: "intruder@example.com",
        password: "Sup3r-secret!",
      }),
    })
    expect(secondRegister.status).toBe(403)
  })
})

describe("Chatbot webhook special", () => {
  it("advertises chatbot webhook routes on the instance bridge", () => {
    expect(HttpApiBridge.supports("/chatbot/slack/mybot", "POST")).toBe(true)
    expect(HttpApiBridge.supports("/chatbot/discord/mybot", "POST")).toBe(true)
    expect(HttpApiBridge.supports("/chatbot/unknown/mybot", "POST")).toBe(false)
  })

  it("returns 404 for an unconfigured connector", async () => {
    const directory = await makeProjectDir()
    const response = await request("/chatbot/slack/missing-bot", directory, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "url_verification" }),
    })
    expect(response.status).toBe(404)
    expect(await response.text()).toBe("Connector not found")
  })
})

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

afterAll(async () => {
  delete process.env.NIKCLI_EXPERIMENTAL_HTTPAPI
  await Instance.disposeAll().catch(() => undefined)
  await Promise.all(projectDirs.map((dir) => removeTestDir(dir)))
  await removeTestDir(testHome)
})
