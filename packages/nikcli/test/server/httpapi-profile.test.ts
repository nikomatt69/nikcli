import { preserveTestEnv } from "../helpers/env"
import { removeTestDir } from "../helpers/fs"
import { afterAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-profile-home-"))
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

const projectDirs: string[] = []

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-profile-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

function request(pathname: string, directory: string, init?: RequestInit) {
  const url = new URL(pathname, "http://nikcli.local")
  url.searchParams.set("directory", directory)
  return Server.fetch(new Request(url, init))
}

/**
 * `/profile` is how the terminal reads and edits the personalization block.
 *
 * The dialog used to run `Profile.Service` in-process. Two things about the wire form are easy to
 * get wrong and invisible from the client: an absent profile has to encode as `null` (the encoder
 * rejects `undefined`), and the prompt preview has to be rendered *here*, by the same code that
 * injects it, so the dialog cannot drift from what agents actually receive.
 */
describe("Profile HttpApi bridge", () => {
  afterAll(async () => {
    await Instance.disposeAll()
    for (const dir of projectDirs) await removeTestDir(dir)
    await removeTestDir(testHome)
  })

  it("encodes an absent profile as null rather than failing to encode undefined", async () => {
    const directory = await makeProjectDir()

    const response = await request("/profile", directory)
    expect(response.status).toBe(200)
    expect(await response.json()).toBeNull()
  })

  it("patches, reads back, and previews what the prompt will carry", async () => {
    const directory = await makeProjectDir()

    const patched = await request("/profile", directory, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ada", role: "engineer" }),
    })
    expect(patched.status).toBe(200)
    expect((await patched.json()) as { name?: string }).toMatchObject({ name: "Ada", role: "engineer" })

    const read = (await (await request("/profile", directory)).json()) as { name?: string }
    expect(read.name).toBe("Ada")

    const preview = (await (await request("/profile/preview", directory)).json()) as {
      lines: string[]
      habitsFile: string
    }
    // The rendered block, not a client-side approximation of it.
    expect(preview.lines.join("\n")).toContain("Ada")
    expect(preview.habitsFile).toContain("habits.md")
  })

  it("reports habits as content, and clearing as a boolean", async () => {
    const directory = await makeProjectDir()

    const habits = await request(`/profile/habits?worktree=${encodeURIComponent(directory)}`, directory)
    expect(habits.status).toBe(200)
    expect((await habits.json()) as { content?: unknown }).toHaveProperty("content")

    const cleared = await request(`/profile/habits?worktree=${encodeURIComponent(directory)}`, directory, {
      method: "DELETE",
    })
    expect(cleared.status).toBe(200)
    expect((await cleared.json()) as { deleted?: unknown }).toHaveProperty("deleted")
  })
})
