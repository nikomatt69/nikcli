import { preserveTestEnv } from "../helpers/env"
import { removeTestDir } from "../helpers/fs"
import { afterAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { SignJWT } from "jose"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-unified-auth-home-"))
const projectDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-unified-auth-project-")))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_TEST_MODE = "1"
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
process.env.NIKCLI_REQUIRE_OAUTH = "1"
process.env.NIKCLI_AUTH_ISSUER = "https://auth.test"
process.env.NIKCLI_AUTH_AUDIENCE = "nikcli-api"
process.env.NIKCLI_AUTH_JWT_SECRET = "test-secret-that-is-long-enough-for-hs256"
process.env.XDG_DATA_HOME = path.join(testHome, "data")
process.env.XDG_CACHE_HOME = path.join(testHome, "cache")
process.env.XDG_CONFIG_HOME = path.join(testHome, "config")
process.env.XDG_STATE_HOME = path.join(testHome, "state")

preserveTestEnv([
  "NIKCLI_TEST_HOME",
  "NIKCLI_TEST_MODE",
  "NIKCLI_DISABLE_PROJECT_CONFIG",
  "NIKCLI_REQUIRE_OAUTH",
  "NIKCLI_AUTH_ISSUER",
  "NIKCLI_AUTH_AUDIENCE",
  "NIKCLI_AUTH_JWT_SECRET",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
])
for (const dir of ["data", "cache", "config", "state"]) {
  await fs.mkdir(path.join(testHome, dir), { recursive: true })
}

const { Instance } = await import("@/project/instance")
const { MobileAuth } = await import("@/mobile/auth")
const { Server } = await import("@/server/server")
const { UserDB } = await import("@/user/users")

async function jwt(overrides: { audience?: string; expiresAt?: number } = {}) {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ email: "identity@example.com", client_id: "nikcli" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("https://auth.test")
    .setAudience(overrides.audience ?? "nikcli-api")
    .setSubject("acc_identity")
    .setIssuedAt(now)
    .setExpirationTime(overrides.expiresAt ?? now + 900)
    .sign(new TextEncoder().encode(process.env.NIKCLI_AUTH_JWT_SECRET!))
}

function request(pathname: string, token?: string) {
  return Server.fetch(
    new Request(`http://nikcli.local${pathname}`, {
      headers: {
        "x-nikcli-directory": projectDir,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    }),
  )
}

afterAll(async () => {
  await Instance.disposeAll().catch(() => undefined)
  await removeTestDir(testHome)
  await removeTestDir(projectDir)
})

describe("unified server authentication", () => {
  it("provisions an issuer identity for /user/me", async () => {
    const response = await request("/user/me", await jwt())
    expect(response.status).toBe(200)
    const body = (await response.json()) as { email: string }
    expect(body.email).toBe("identity@example.com")
    expect(UserDB.ensureExternalUser({ sub: "acc_identity", email: body.email }).id).toStartWith("usr_")
  })

  it("accepts issuer identity on a /mobile route", async () => {
    const response = await request("/mobile/project", await jwt())
    expect(response.status).toBe(200)
  })

  it("rejects expired and wrong-audience issuer JWTs", async () => {
    const now = Math.floor(Date.now() / 1000)
    expect((await request("/user/me", await jwt({ expiresAt: now - 61 }))).status).toBe(401)
    expect((await request("/user/me", await jwt({ audience: "other-api" }))).status).toBe(401)
  })

  it("keeps scoped capability tokens while OAuth is required", async () => {
    const capability = await MobileAuth.create({
      name: "oauth-matrix",
      scope: "mobile",
    })
    expect((await request("/mobile/project", capability.token)).status).toBe(200)
  })

  it("rejects legacy sessions and anonymous requests while OAuth is required", async () => {
    const user = await UserDB.create({
      username: "legacy",
      email: "legacy@example.com",
      password: "Password1!",
    })
    const legacy = UserDB.createSession(user.id, 1)
    expect((await request("/user/me", legacy)).status).toBe(401)
    expect((await request("/mobile/project")).status).toBe(401)
  })

  it("closes password login and registration", async () => {
    const login = await Server.fetch(
      new Request("http://nikcli.local/user/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "legacy@example.com",
          password: "Password1!",
        }),
      }),
    )
    expect(login.status).toBe(401)
  })
})
