import { preserveTestEnv } from "../helpers/env"
import { removeTestDir } from "../helpers/fs"
import { afterAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-account-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_MODELS_FETCH = "1"
process.env.XDG_DATA_HOME = path.join(testHome, "data")
process.env.XDG_CACHE_HOME = path.join(testHome, "cache")
process.env.XDG_CONFIG_HOME = path.join(testHome, "config")
process.env.XDG_STATE_HOME = path.join(testHome, "state")

preserveTestEnv([
  "NIKCLI_TEST_HOME",
  "NIKCLI_DISABLE_MODELS_FETCH",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
])

const { Instance } = await import("@/project/instance")
const { Server } = await import("@/server/server")
const { UserDB } = await import("@/user/users")
const { isAccountPath } = await import("@/server/httpapi/account-path")

function get(pathname: string, token?: string) {
  return Server.fetch(
    new Request(new URL(pathname, "http://nikcli.local"), {
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    }),
  )
}

/**
 * `/account` has to reach the instance-less handlers.
 *
 * Four places decide that — the bridge, `Server.fallback`, the router's global
 * test and `PublicRoutes` — and the bare `/account` is the case a
 * `startsWith("/account/")` test silently gets wrong: the request falls through
 * to the instance branch and 404s with no directory bound. That failure looks
 * like "no account", which is a legitimate answer, so nothing would report it.
 */
describe("account routing", () => {
  afterAll(async () => {
    await Instance.disposeAll()
    await removeTestDir(testHome)
  })

  it("claims the bare path as well as the subtree", () => {
    expect(isAccountPath("/account")).toBe(true)
    expect(isAccountPath("/account/login")).toBe(true)
    expect(isAccountPath("/accounts")).toBe(false)
    expect(isAccountPath("/session/account")).toBe(false)
  })

  it("answers null rather than 404 for an unauthenticated caller", async () => {
    const response = await get("/account")
    expect(response.status).toBe(200)
    expect(await response.json()).toBeNull()
  })

  it("answers null for a signed-in caller with no linked account", async () => {
    const user = await UserDB.create({
      username: "local-only",
      email: "local-only@example.com",
      password: "Password1!",
    })
    const token = UserDB.createSession(user.id, 30)

    const response = await get("/account", token)
    expect(response.status).toBe(200)
    // A local password account is not an issuer account: reaching the handler
    // is the assertion, and `null` is the correct answer for this machine.
    expect(await response.json()).toBeNull()
  })
})
