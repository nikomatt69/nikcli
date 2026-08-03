import { describe, expect, it } from "bun:test"
import { mkdtemp, readdir, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { pathToFileURL } from "url"
import { createSourceWatcher, entrypointMtime, freshSpecifier, localSource } from "@/cli/cmd/tui/plugin/reload"
import { clearPluginStorage, pluginStorage } from "@/cli/cmd/tui/plugin/storage"

async function scratch() {
  const dir = await mkdtemp(path.join(tmpdir(), "nikcli-tui-reload-"))
  return {
    path: dir,
    async [Symbol.asyncDispose]() {
      await rm(dir, { recursive: true, force: true })
    },
  }
}

// fs.watch delivery can lag several seconds when the suite runs many files in
// one process, so wait generously; the loop returns as soon as the event lands.
async function until(check: () => boolean, attempts = 400) {
  for (let i = 0; i < attempts; i++) {
    if (check()) return true
    await Bun.sleep(20)
  }
  return check()
}

describe("tui plugin hot reload helpers", () => {
  it("localSource resolves file URLs and local paths but not package specs", () => {
    const base = process.cwd()
    const absolute = path.resolve(base, "abs", "plugin.ts")
    expect(localSource("file:///tmp/plugin.ts", base)?.href).toBe("file:///tmp/plugin.ts")
    expect(localSource("./plugin.ts", base)?.href).toBe(pathToFileURL(path.join(base, "plugin.ts")).href)
    expect(localSource("../plugin.ts", path.join(base, "nested"))?.href).toBe(
      pathToFileURL(path.join(base, "plugin.ts")).href,
    )
    expect(localSource(absolute, base)?.href).toBe(pathToFileURL(absolute).href)
    expect(localSource("some-package", base)).toBeUndefined()
    expect(localSource("@scope/some-package", base)).toBeUndefined()
  })

  it("freshSpecifier re-imports a plugin source after it changes", async () => {
    await using tmp = await scratch()
    const file = path.join(tmp.path, "plugin.ts")
    await writeFile(file, "export default 1")
    const first: { default?: unknown } = await import(freshSpecifier(pathToFileURL(file).href, 1))
    await writeFile(file, "export default 2")
    const second: { default?: unknown } = await import(freshSpecifier(pathToFileURL(file).href, 2))
    expect(first.default).toBe(1)
    expect(second.default).toBe(2)
  })

  it("freshSpecifier keys the same source by mtime", () => {
    const href = pathToFileURL(path.join(process.cwd(), "plugin.ts")).href
    expect(freshSpecifier(href, 1)).not.toBe(freshSpecifier(href, 2))
    expect(freshSpecifier(href, 1)).toBe(freshSpecifier(href, 1))
  })

  it("entrypointMtime reads existing sources and skips missing ones", async () => {
    await using tmp = await scratch()
    const file = path.join(tmp.path, "plugin.ts")
    await writeFile(file, "export default {}")
    expect(entrypointMtime(pathToFileURL(file).href)).toBeGreaterThan(0)
    expect(entrypointMtime(path.join(tmp.path, "missing.ts"))).toBeUndefined()
  })

  it("watches a source file through its parent directory and debounces edits", async () => {
    await using tmp = await scratch()
    const file = path.join(tmp.path, "plugin.ts")
    await writeFile(file, "export default 1")

    let changes = 0
    const watcher = createSourceWatcher({
      onChange: () => changes++,
      debounce: 20,
    })
    try {
      watcher.add(file)
      // fs.watch (FSEvents) can drop an edit that lands before the stream is
      // fully armed, and delivery lags when the suite runs many files in one
      // process: keep rewriting until the watcher observes a change, bounded
      // to ~10s so a genuinely broken watcher still fails fast.
      let observed = false
      for (let attempt = 0; attempt < 10 && !observed; attempt++) {
        await writeFile(file, `export default ${attempt + 2}`)
        observed = await until(() => changes > 0, 50)
      }
      expect(observed).toBe(true)

      // Edits to unrelated files in the same directory are filtered out.
      const before = changes
      await writeFile(path.join(tmp.path, "other.txt"), "noise")
      await Bun.sleep(80)
      expect(changes).toBe(before)
    } finally {
      watcher.dispose()
    }
  })

  it("stops reporting changes after dispose", async () => {
    await using tmp = await scratch()
    const file = path.join(tmp.path, "plugin.ts")
    await writeFile(file, "export default 1")

    let changes = 0
    const watcher = createSourceWatcher({
      onChange: () => changes++,
      debounce: 10,
    })
    watcher.add(file)
    watcher.dispose()
    await writeFile(file, "export default 2")
    await Bun.sleep(80)
    expect(changes).toBe(0)
  })
})

describe("tui plugin memory storage", () => {
  it("hands the same live store to a reloaded plugin generation", () => {
    clearPluginStorage()
    const [first, update] = pluginStorage("acme.demo").memory("counter", {
      initial: { count: 0 },
    })
    update((draft) => {
      draft.count += 1
    })
    expect(first.count).toBe(1)

    // A hot reload builds a fresh api for the same plugin id: same store.
    const [second, updateAgain] = pluginStorage("acme.demo").memory("counter", {
      initial: { count: 0 },
    })
    expect(second).toBe(first)
    updateAgain((draft) => {
      draft.count += 1
    })
    expect(second.count).toBe(2)
  })

  it("namespaces stores per plugin id and key", () => {
    clearPluginStorage()
    const [a] = pluginStorage("acme.a").memory("state", {
      initial: { value: "a" },
    })
    const [b] = pluginStorage("acme.b").memory("state", {
      initial: { value: "b" },
    })
    const [other] = pluginStorage("acme.a").memory("other", {
      initial: { value: "c" },
    })
    expect(a.value).toBe("a")
    expect(b.value).toBe("b")
    expect(other.value).toBe("c")
    expect(a).not.toBe(b)
    expect(a).not.toBe(other)
  })
})

describe("tui plugin durable store", () => {
  it("persists JSON to disk and survives a reset", async () => {
    await using tmp = await scratch()
    // Global.Path.state is a lazy getter: pointing it at a scratch dir keeps
    // the durable store out of the developer's real state directory.
    process.env.NIKCLI_TEST_HOME = tmp.path
    clearPluginStorage()

    const [state, update] = pluginStorage("acme.demo").store("settings", {
      initial: { theme: "dark", count: 0 },
    })
    expect(state.theme).toBe("dark")
    await update((draft) => {
      draft.theme = "light"
      draft.count += 1
    })
    expect(state.theme).toBe("light")
    expect(state.count).toBe(1)

    // A "restart" (fresh module state, same disk) re-reads the persisted file.
    clearPluginStorage()
    const [again] = pluginStorage("acme.demo").store("settings", {
      initial: { theme: "dark", count: 0 },
    })
    expect(again.theme).toBe("light")
    expect(again.count).toBe(1)
  })

  it("writes one JSON file per plugin id and key, via temp file + rename", async () => {
    await using tmp = await scratch()
    process.env.NIKCLI_TEST_HOME = tmp.path
    clearPluginStorage()

    const [a, updateA] = pluginStorage("acme.a").store("state", {
      initial: { value: "a" },
    })
    await updateA((draft) => {
      draft.value = "a1"
    })
    const [b, updateB] = pluginStorage("acme.b").store("state", {
      initial: { value: "b" },
    })
    await updateB((draft) => {
      draft.value = "b1"
    })
    expect(a.value).toBe("a1")
    expect(b.value).toBe("b1")

    const dir = path.join(tmp.path, "state", "tui", "plugin")
    const files = await readdir(dir)
    expect(files.sort()).toEqual(["acme.a.state.json", "acme.b.state.json"])
    // No temp files left behind by the rename-based write.
    expect(files.every((file) => !file.includes(".tmp"))).toBe(true)
  })
})
