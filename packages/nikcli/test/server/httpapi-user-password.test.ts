import { preserveTestEnv } from "../helpers/env"
import { removeTestDir } from "../helpers/fs"
import { afterAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-user-password-home-"))
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

function post(pathname: string, token: string | undefined, body: unknown) {
  return Server.fetch(
    new Request(new URL(pathname, "http://nikcli.local"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  )
}

/**
 * Changing your own password proves the old one first.
 *
 * `PATCH /user/:id` can set a password but never asks for the current one — an
 * admin resetting another account has none to give. The terminal used to make
 * up the difference itself: read the user row, call `verifyPassword`, and then
 * decide whether to proceed. This route keeps that check on the same side as
 * the hash, and these assert that a wrong current password changes nothing.
 */
describe("POST /user/me/password", () => {
  afterAll(async () => {
    await Instance.disposeAll()
    await removeTestDir(testHome)
  })

  it("refuses an unauthenticated caller", async () => {
    const response = await post("/user/me/password", undefined, { current: "x", next: "Password2!" })
    expect(response.status).toBe(401)
  })

  it("rejects a wrong current password and leaves the old one working", async () => {
    const user = await UserDB.create({
      username: "rotator",
      email: "rotator@example.com",
      password: "Password1!",
    })
    const token = UserDB.createSession(user.id, 30)

    const wrong = await post("/user/me/password", token, { current: "not-it", next: "Password2!" })
    expect(wrong.status).toBe(403)

    const record = UserDB.findById(user.id)!
    expect(await UserDB.verifyPassword(record, "Password1!")).toBe(true)
  })

  it("rejects a new password shorter than the minimum", async () => {
    const user = await UserDB.create({
      username: "shorty",
      email: "shorty@example.com",
      password: "Password1!",
    })
    const token = UserDB.createSession(user.id, 30)

    const short = await post("/user/me/password", token, { current: "Password1!", next: "short" })
    expect(short.status).toBe(400)
  })

  it("rotates the password when the current one is right", async () => {
    const user = await UserDB.create({
      username: "changer",
      email: "changer@example.com",
      password: "Password1!",
    })
    const token = UserDB.createSession(user.id, 30)

    const changed = await post("/user/me/password", token, { current: "Password1!", next: "Password2!" })
    expect(changed.status).toBe(200)

    const record = UserDB.findById(user.id)!
    expect(await UserDB.verifyPassword(record, "Password2!")).toBe(true)
    expect(await UserDB.verifyPassword(record, "Password1!")).toBe(false)
  })
})
