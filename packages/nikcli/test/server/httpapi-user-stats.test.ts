import { preserveTestEnv } from "../helpers/env"
import { removeTestDir } from "../helpers/fs"
import { afterAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-user-stats-home-"))
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

/** `/user/*` is instance-less — the middleware skips it, so no directory is bound. */
function request(pathname: string, token?: string) {
  return Server.fetch(
    new Request(new URL(pathname, "http://nikcli.local"), {
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    }),
  )
}

/**
 * The profile view's two counters come from the caller's own session.
 *
 * The terminal used to read `listContacts()` and `getTotalUnreadCount()` in
 * process for whichever user id the dialog happened to hold. Over the wire that
 * id is not something a route may trust, so the handler derives it from the
 * bearer — and this asserts that it does, by giving one user's token and
 * counting another user's contact.
 */
describe("GET /user/me/stats", () => {
  afterAll(async () => {
    await Instance.disposeAll()
    await removeTestDir(testHome)
  })

  it("refuses an unauthenticated caller", async () => {
    const response = await request("/user/me/stats")
    expect(response.status).toBe(401)
  })

  it("counts contacts and unread messages for the bearer's own account", async () => {
    const owner = await UserDB.create({
      username: "owner",
      email: "owner@example.com",
      password: "Password1!",
    })
    const friend = await UserDB.create({
      username: "friend",
      email: "friend@example.com",
      password: "Password1!",
    })
    const token = UserDB.createSession(owner.id, 30)

    const empty = await request("/user/me/stats", token)
    expect(empty.status).toBe(200)
    expect(await empty.json()).toEqual({ contacts: 0, unread: 0 })

    // `addContact` is bidirectional, so both accounts gain one.
    UserDB.addContact(owner.id, friend.id)
    UserDB.sendMessage(friend.id, owner.id, "hello")

    // SAFETY: this is the body of `/user/me/stats`, the route under test.
    const filled = (await (await request("/user/me/stats", token)).json()) as {
      contacts: number
      unread: number
    }
    expect(filled).toEqual({ contacts: 1, unread: 1 })
  })
})
