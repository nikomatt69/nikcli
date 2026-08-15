import { preserveTestEnv } from "../helpers/env"
import { removeTestDir } from "../helpers/fs"
import { afterAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-tui-home-"))
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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-tui-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

function request(pathname: string, directory: string) {
  const url = new URL(pathname, "http://nikcli.local")
  url.searchParams.set("directory", directory)
  return Server.fetch(new Request(url))
}

/**
 * `GET /tui/config` is how the terminal reads its own configuration once it has a transport.
 *
 * The response goes through the HttpApi encoder, which validates it against the declared schema —
 * and the merge that produces this document leaves explicitly-`undefined` keys behind. Encoding
 * one of those fails with "Expected JSON value, got undefined", surfacing as a 400 with an empty
 * body: from the TUI's side that is indistinguishable from an empty config, with nothing logged.
 * So assert the status *and* that real content came back.
 */
describe("Tui config HttpApi bridge", () => {
  afterAll(async () => {
    await Instance.disposeAll()
    for (const dir of projectDirs) await removeTestDir(dir)
    await removeTestDir(testHome)
  })

  it("serves the merged tui config via Server.fetch", async () => {
    const directory = await makeProjectDir()

    const response = await request("/tui/config", directory)
    expect(response.status).toBe(200)

    const body = (await response.json()) as { keybinds?: Record<string, unknown> }
    expect(body).toBeObject()
    // The defaults alone carry a full keybind table, so an encoder that dropped the document
    // would show up here rather than as a silently empty panel.
    expect(body.keybinds).toBeObject()
    expect(Object.keys(body.keybinds ?? {}).length).toBeGreaterThan(0)
  })

  it("keeps the response encodable when the config file sets a plugin tuple", async () => {
    const directory = await makeProjectDir()
    // A plugin entry is either a bare specifier or a `[specifier, options]` pair. The tuple form
    // is why `zod-effect` had to learn `tuple` at all — before that this route could not be
    // declared, because deriving its schema threw at startup.
    await fs.mkdir(path.join(directory, ".nikcli"), { recursive: true })
    await fs.writeFile(
      path.join(directory, ".nikcli", "tui.json"),
      JSON.stringify({ plugin: ["some-plugin", ["other-plugin", { flag: true }]] }),
    )

    const response = await request("/tui/config", directory)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { plugin?: unknown[] }
    expect(body.plugin).toBeArray()
  })
})
