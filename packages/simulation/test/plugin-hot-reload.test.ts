import { expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { connect, type DriverSocket } from "../src/driver"
import type { SimulationProtocol } from "../src/protocol"

const nikcli = resolve(import.meta.dir, "../../nikcli")

async function freePort() {
  return new Promise<number>((resolvePort, reject) => {
    const probe = createServer()
    probe.once("error", reject)
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address()
      if (!address || typeof address === "string") {
        probe.close()
        reject(new Error("Unable to allocate simulation test port"))
        return
      }
      probe.close((error) => (error ? reject(error) : resolvePort(address.port)))
    })
  })
}

/**
 * A TUI plugin that records its own lifecycle. Marker files are the signal:
 * they show which generation ran and, crucially, which plugins were left
 * untouched by someone else's reload.
 */
function lifecycleSource(marker: string, id: string, version: string) {
  return `
import { appendFile } from "node:fs/promises"
export default {
  id: ${JSON.stringify(id)},
  tui: async (api) => {
    await appendFile(${JSON.stringify(marker)}, "${version}:setup\\n")
    api.lifecycle.onDispose(() => appendFile(${JSON.stringify(marker)}, "${version}:cleanup\\n"))
  },
}
`
}

async function until(read: () => Promise<string>, expected: (value: string | undefined) => boolean, attempts = 300) {
  let value: string | undefined
  for (let i = 0; i < attempts; i++) {
    value = await read().catch(() => undefined)
    if (expected(value)) return value
    await Bun.sleep(50)
  }
  return value
}

/**
 * Boots the real TUI headless against the given project directory, with plugin
 * sources living outside `.nikcli/plugins` (which the server-side plugin loader
 * scans) so they load only as TUI plugins.
 */
async function bootTui(root: string, name: string) {
  const registry = join(root, "registry")
  const media = join(root, "media")
  const project = join(root, "project")
  const plugins = join(project, "tui-plugins")
  await Promise.all([mkdir(registry, { recursive: true }), mkdir(media, { recursive: true })])
  await mkdir(plugins, { recursive: true })
  await mkdir(join(project, ".nikcli"), { recursive: true })

  return {
    project,
    plugins,
    async configure(specs: string[]) {
      await writeFile(join(project, ".nikcli", "tui.json"), JSON.stringify({ plugin: specs }))
    },
    async configureRaw(config: Record<string, unknown>) {
      await writeFile(join(project, ".nikcli", "tui.json"), JSON.stringify(config))
    },
    async start() {
      const [uiPort, backendPort, openaiPort] = await Promise.all([freePort(), freePort(), freePort()])
      const manifest = {
        endpoints: {
          ui: `ws://127.0.0.1:${uiPort}`,
          backend: `ws://127.0.0.1:${backendPort}`,
          openai: `http://127.0.0.1:${openaiPort}`,
        },
        viewport: { cols: 100, rows: 30 },
      }
      await Bun.write(join(registry, `${name}.json`), JSON.stringify(manifest))

      const child = Bun.spawn(
        [
          process.execPath,
          "run",
          "--conditions=browser",
          "./src/index.ts",
          project,
          "--model",
          "simulation/deterministic",
        ],
        {
          // Run from the nikcli package so its bunfig/tsconfig (JSX runtime)
          // apply; the TUI chdirs into the project directory passed as the arg.
          cwd: nikcli,
          env: {
            ...process.env,
            NIKCLI_DRIVE: name,
            NIKCLI_DRIVE_REGISTRY_DIR: registry,
            NIKCLI_DRIVE_RENDERER: "headless",
            NIKCLI_DRIVE_MEDIA_DIR: media,
            NIKCLI_TEST_HOME: join(root, "home"),
            NIKCLI_SKIP_PLUGIN_INSTALL: "1",
            NIKCLI_DISABLE_DEFAULT_PLUGINS: "1",
            NIKCLI_DISABLE_LSP_DOWNLOAD: "1",
            XDG_DATA_HOME: join(root, "xdg-data"),
            XDG_CACHE_HOME: join(root, "xdg-cache"),
            XDG_CONFIG_HOME: join(root, "xdg-config"),
            XDG_STATE_HOME: join(root, "xdg-state"),
          },
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        },
      )
      const stdout = new Response(child.stdout).text()
      const stderr = new Response(child.stderr).text()
      let ui: DriverSocket | undefined
      try {
        // Generous: booting the real TUI on a loaded machine (this file boots
        // it several times) can take well over half a minute.
        ui = await connect(manifest.endpoints.ui, { timeoutMs: 120_000 })
        await ui.call<SimulationProtocol.Frontend.State>("ui.state")
      } catch (error) {
        child.kill(9)
        await child.exited
        throw new Error(
          `${error instanceof Error ? error.stack : error}\nstdout:\n${await stdout}\nstderr:\n${await stderr}`,
        )
      }

      return {
        async report(error: unknown) {
          return new Error(
            `${error instanceof Error ? error.stack : error}\nstdout:\n${await stdout}\nstderr:\n${await stderr}`,
          )
        },
        async stop() {
          ui?.close()
          // SIGTERM first: SIGKILL leaves the TUI's server and worker children
          // orphaned, and a few of those pile up enough to starve the next boot
          // in this file. Fall back to SIGKILL if it does not exit in time.
          child.kill("SIGTERM")
          const exited = await Promise.race([child.exited.then(() => true), Bun.sleep(5_000).then(() => false)])
          if (!exited) {
            child.kill(9)
            await child.exited
          }
          // Let the OS reclaim ports and file handles before the next boot.
          await Bun.sleep(250)
        },
      }
    },
  }
}

// Booting the real TUI is the expensive part, so each test drives as many
// scenarios as it can through a single boot. Six boots in one process starved
// each other and turned the file flaky.

test("hot-reloads edited plugins in place, keeping the rest of the TUI untouched", async () => {
  const root = await mkdtemp(join(tmpdir(), "nikcli-plugin-reload-"))
  const app = await bootTui(root, "reload")

  const markerA = join(root, "a.txt")
  const markerB = join(root, "b.txt")
  const markerCounter = join(root, "counter.txt")
  const markerDiscovered = join(root, "discovered.txt")
  const sourceA = join(app.plugins, "a.ts")
  const sourceB = join(app.plugins, "b.ts")
  const sourceCounter = join(app.plugins, "counter.ts")
  const discovery = join(app.project, ".nikcli", "plugin", "tui")
  const sourceDiscovered = join(discovery, "discovered.ts")

  const counterSource = (note: string) => `
import { appendFile } from "node:fs/promises"
// ${note}
export default {
  id: "test.counter",
  tui: async (api) => {
    const [state, update] = api.storage.memory("counter", { initial: { count: 0 } })
    update((draft) => {
      draft.count += 1
    })
    await appendFile(${JSON.stringify(markerCounter)}, "count:" + state.count + "\\n")
  },
}
`

  await mkdir(discovery, { recursive: true })
  await writeFile(sourceA, lifecycleSource(markerA, "test.a", "a1"))
  await writeFile(sourceB, lifecycleSource(markerB, "test.b", "b1"))
  await writeFile(sourceCounter, counterSource("v1"))
  await writeFile(sourceDiscovered, lifecycleSource(markerDiscovered, "test.discovered", "d1"))
  // `discovered.ts` is deliberately not configured: it loads by discovery alone.
  await app.configure(["../tui-plugins/a.ts", "../tui-plugins/b.ts", "../tui-plugins/counter.ts"])

  const readA = () => readFile(markerA, "utf8")
  const readB = () => readFile(markerB, "utf8")
  const readCounter = () => readFile(markerCounter, "utf8")
  const readDiscovered = () => readFile(markerDiscovered, "utf8")
  const tui = await app.start()
  try {
    expect(await until(readA, (value) => value === "a1:setup\n")).toBe("a1:setup\n")
    expect(await until(readB, (value) => value === "b1:setup\n")).toBe("b1:setup\n")
    expect(await until(readCounter, (value) => value === "count:1\n")).toBe("count:1\n")
    expect(await until(readDiscovered, (value) => value === "d1:setup\n")).toBe("d1:setup\n")

    // Editing B restarts only B: A sees no cleanup and no second setup.
    await writeFile(sourceB, lifecycleSource(markerB, "test.b", "b2"))
    expect(await until(readB, (value) => value?.includes("b2:setup") ?? false)).toBe("b1:setup\nb1:cleanup\nb2:setup\n")
    expect(await readA()).toBe("a1:setup\n")

    // A broken save keeps the last good version running: b2 is never cleaned
    // up. Editing A afterwards is the completion signal — once A's swap lands,
    // the serialized reload chain has already processed the broken save.
    await writeFile(sourceB, "export default {")
    await writeFile(sourceA, lifecycleSource(markerA, "test.a", "a2"))
    expect(await until(readA, (value) => value?.includes("a2:setup") ?? false)).toBe("a1:setup\na1:cleanup\na2:setup\n")
    expect(await readB()).toBe("b1:setup\nb1:cleanup\nb2:setup\n")

    // Fixing the file swaps the fix in and leaves A alone.
    await writeFile(sourceB, lifecycleSource(markerB, "test.b", "b3"))
    expect(await until(readB, (value) => value?.includes("b3:setup") ?? false)).toBe(
      "b1:setup\nb1:cleanup\nb2:setup\nb2:cleanup\nb3:setup\n",
    )
    expect(await readA()).toBe("a1:setup\na1:cleanup\na2:setup\n")

    // The reloaded generation shares the same live memory store: count continues.
    await writeFile(sourceCounter, counterSource("v2"))
    expect(await until(readCounter, (value) => value?.includes("count:2") ?? false)).toBe("count:1\ncount:2\n")

    // Discovered plugins hot reload exactly like configured ones.
    await writeFile(sourceDiscovered, lifecycleSource(markerDiscovered, "test.discovered", "d2"))
    expect(await until(readDiscovered, (value) => value?.includes("d2:setup") ?? false)).toBe(
      "d1:setup\nd1:cleanup\nd2:setup\n",
    )
  } catch (error) {
    throw await tui.report(error)
  } finally {
    await tui.stop()
    if (!process.env.NIKCLI_E2E_KEEP) await rm(root, { recursive: true, force: true })
  }
}, 300_000)

test("follows tui.json changes: added, removed, discovered late, and disabled plugins", async () => {
  const root = await mkdtemp(join(tmpdir(), "nikcli-plugin-config-"))
  const app = await bootTui(root, "config")

  const markerA = join(root, "a.txt")
  const markerB = join(root, "b.txt")
  const markerLate = join(root, "late.txt")
  await writeFile(join(app.plugins, "a.ts"), lifecycleSource(markerA, "test.a", "a1"))
  await writeFile(join(app.plugins, "b.ts"), lifecycleSource(markerB, "test.b", "b1"))
  await app.configure(["../tui-plugins/a.ts"])

  const readA = () => readFile(markerA, "utf8")
  const readB = () => readFile(markerB, "utf8")
  const readLate = () => readFile(markerLate, "utf8")
  const tui = await app.start()
  try {
    expect(await until(readA, (value) => value === "a1:setup\n")).toBe("a1:setup\n")
    expect(await readB().catch(() => undefined)).toBeUndefined()

    // Adding an entry loads that plugin and leaves the running one alone.
    await app.configure(["../tui-plugins/a.ts", "../tui-plugins/b.ts"])
    expect(await until(readB, (value) => value === "b1:setup\n")).toBe("b1:setup\n")
    expect(await readA()).toBe("a1:setup\n")

    // Removing an entry tears that plugin down, again leaving the other alone.
    await app.configure(["../tui-plugins/b.ts"])
    expect(await until(readA, (value) => value?.includes("a1:cleanup") ?? false)).toBe("a1:setup\na1:cleanup\n")
    expect(await readB()).toBe("b1:setup\n")

    // `.nikcli/plugin/tui` does not exist yet: its nearest existing ancestor is
    // watched, so creating the directory reaches the running TUI.
    const discovery = join(app.project, ".nikcli", "plugin", "tui")
    await mkdir(discovery, { recursive: true })
    await writeFile(join(discovery, "late.ts"), lifecycleSource(markerLate, "test.late", "v1"))
    expect(await until(readLate, (value) => value === "v1:setup\n")).toBe("v1:setup\n")

    // Disabling in the config disposes the plugin; re-enabling initializes it.
    await app.configureRaw({ plugin: ["../tui-plugins/b.ts"], plugin_enabled: { "test.late": false } })
    expect(await until(readLate, (value) => value?.includes("v1:cleanup") ?? false)).toBe("v1:setup\nv1:cleanup\n")

    await app.configureRaw({ plugin: ["../tui-plugins/b.ts"], plugin_enabled: { "test.late": true } })
    expect(await until(readLate, (value) => (value?.match(/v1:setup/g)?.length ?? 0) === 2)).toBe(
      "v1:setup\nv1:cleanup\nv1:setup\n",
    )
  } catch (error) {
    throw await tui.report(error)
  } finally {
    await tui.stop()
    if (!process.env.NIKCLI_E2E_KEEP) await rm(root, { recursive: true, force: true })
  }
}, 300_000)

test("storage.store persists plugin state across TUI restarts", async () => {
  const root = await mkdtemp(join(tmpdir(), "nikcli-plugin-store-"))
  const app = await bootTui(root, "store")

  const marker = join(root, "runs.txt")
  await writeFile(
    join(app.plugins, "runs.ts"),
    `
import { appendFile } from "node:fs/promises"
export default {
  id: "test.runs",
  tui: async (api) => {
    const [state, update] = api.storage.store("runs", { initial: { count: 0 } })
    await update((draft) => {
      draft.count += 1
    })
    await appendFile(${JSON.stringify(marker)}, "runs:" + state.count + "\\n")
  },
}
`,
  )
  await app.configure(["../tui-plugins/runs.ts"])

  const read = () => readFile(marker, "utf8")
  const first = await app.start()
  try {
    expect(await until(read, (value) => value === "runs:1\n")).toBe("runs:1\n")
  } catch (error) {
    throw await first.report(error)
  } finally {
    await first.stop()
  }

  // A fresh process reads the persisted value back: the counter keeps going.
  const second = await app.start()
  try {
    expect(await until(read, (value) => value?.includes("runs:2") ?? false)).toBe("runs:1\nruns:2\n")
  } catch (error) {
    throw await second.report(error)
  } finally {
    await second.stop()
    if (!process.env.NIKCLI_E2E_KEEP) await rm(root, { recursive: true, force: true })
  }
}, 300_000)
