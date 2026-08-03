import { preserveTestEnv } from "../helpers/env"
import { describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { pathToFileURL } from "url"

const testHome = await mkdtemp(path.join(tmpdir(), "nikcli-tui-discovery-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
process.env.XDG_DATA_HOME = path.join(testHome, "data")
process.env.XDG_CACHE_HOME = path.join(testHome, "cache")
process.env.XDG_CONFIG_HOME = path.join(testHome, "config")
process.env.XDG_STATE_HOME = path.join(testHome, "state")

preserveTestEnv([
  "NIKCLI_TEST_HOME",
  "NIKCLI_DISABLE_PROJECT_CONFIG",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
])

const { TuiConfig } = await import("@/config/tui")

async function scratch() {
  const dir = await mkdtemp(path.join(tmpdir(), "nikcli-tui-discovery-"))
  return {
    path: dir,
    async [Symbol.asyncDispose]() {
      await rm(dir, { recursive: true, force: true })
    },
  }
}

describe("tui plugin discovery", () => {
  it("scans plugin/tui and plugins/tui, not the server plugin roots", async () => {
    await using tmp = await scratch()
    const root = path.join(tmp.path, ".nikcli")
    await mkdir(path.join(root, "plugin", "tui"), { recursive: true })
    await mkdir(path.join(root, "plugins", "tui"), { recursive: true })

    await writeFile(path.join(root, "plugin", "tui", "one.tsx"), "export default {}")
    await writeFile(path.join(root, "plugins", "tui", "two.ts"), "export default {}")
    // Server plugin territory: `{plugin,plugins}/*` is loaded by the server.
    await writeFile(path.join(root, "plugin", "server-only.ts"), "export default {}")
    // Unsupported extension and nested directories are ignored.
    await writeFile(path.join(root, "plugin", "tui", "notes.md"), "# notes")
    await mkdir(path.join(root, "plugin", "tui", "nested"), { recursive: true })
    await writeFile(path.join(root, "plugin", "tui", "nested", "deep.ts"), "export default {}")

    const found = await TuiConfig.discoverPlugins(root)
    expect(found).toEqual([
      pathToFileURL(path.join(root, "plugin", "tui", "one.tsx")).href,
      pathToFileURL(path.join(root, "plugins", "tui", "two.ts")).href,
    ])
  })

  it("follows symlinked plugin files", async () => {
    await using tmp = await scratch()
    const root = path.join(tmp.path, ".nikcli")
    const directory = path.join(root, "plugin", "tui")
    await mkdir(directory, { recursive: true })
    const target = path.join(tmp.path, "external.ts")
    await writeFile(target, "export default {}")
    await symlink(target, path.join(directory, "linked.ts"))

    expect(await TuiConfig.discoverPlugins(root)).toEqual([pathToFileURL(path.join(directory, "linked.ts")).href])
  })

  it("returns nothing for a config root without plugin directories", async () => {
    await using tmp = await scratch()
    expect(await TuiConfig.discoverPlugins(path.join(tmp.path, "missing"))).toEqual([])
  })

  it("reports the directories it scans per config root", () => {
    expect(TuiConfig.pluginDirectories("/tmp/root")).toEqual([
      path.join("/tmp/root", "plugin", "tui"),
      path.join("/tmp/root", "plugins", "tui"),
    ])
  })
})
