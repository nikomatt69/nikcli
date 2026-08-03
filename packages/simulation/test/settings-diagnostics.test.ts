/**
 * Drives the real TUI to the Diagnostics settings category.
 *
 * The per-turn token table has existed since `feat(tui): add per-turn token
 * breakdown feature` but was reachable only by hand-editing `nikcli.json`.
 * A unit test on the category list would prove the entry exists in an array;
 * only rendering it in the real app proves the dialog's context hooks resolve
 * and the config-backed row reads its value without throwing.
 */
import { expect, test } from "bun:test"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
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

async function eventually<T>(fn: () => Promise<T | undefined>, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const value = await fn()
      if (value !== undefined) return value
    } catch (error) {
      lastError = error
    }
    await Bun.sleep(50)
  }
  throw new Error("Simulation condition did not become true", { cause: lastError })
}

test("opens the Diagnostics settings category in the real TUI", async () => {
  const root = await mkdtemp(join(tmpdir(), "nikcli-simulation-settings-"))
  const registry = join(root, "registry")
  const media = join(root, "media")
  const project = join(root, "project")
  await Promise.all([mkdir(registry, { recursive: true }), mkdir(media, { recursive: true }), mkdir(project)])
  const [uiPort, backendPort, openaiPort] = await Promise.all([freePort(), freePort(), freePort()])
  const manifest = {
    endpoints: {
      ui: `ws://127.0.0.1:${uiPort}`,
      backend: `ws://127.0.0.1:${backendPort}`,
      openai: `http://127.0.0.1:${openaiPort}`,
    },
    viewport: { cols: 100, rows: 30 },
  }
  await Bun.write(join(registry, "settings.json"), JSON.stringify(manifest))

  const child = Bun.spawn(
    [process.execPath, "run", "--conditions=browser", "./src/index.ts", project, "--model", "simulation/deterministic"],
    {
      cwd: nikcli,
      env: {
        ...process.env,
        NIKCLI_DRIVE: "settings",
        NIKCLI_DRIVE_REGISTRY_DIR: registry,
        NIKCLI_DRIVE_RENDERER: "headless",
        NIKCLI_DRIVE_MEDIA_DIR: media,
        NIKCLI_TEST_HOME: join(root, "home"),
        // Unlike the other drive tests this one must NOT disable project
        // config: the whole point is that the toggle writes the project's
        // `nikcli.json` and the server reads it back. The project is a fresh
        // temp dir, so discovery still cannot reach the repo's own config.
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
    ui = await connect(manifest.endpoints.ui, { timeoutMs: 30_000 })
    await eventually(async () => {
      const state = await ui!.call<SimulationProtocol.Frontend.State>("ui.state")
      return state.screen.includes("Ask anything") ? state : undefined
    })

    // Ctrl+P is the command palette in nikcli (not Ctrl+K).
    await ui.call("ui.press", { key: "p", modifiers: { ctrl: true } })
    await ui.call("ui.type", { text: "Diagnostics" })

    const palette = await eventually(async () => {
      const state = await ui!.call<SimulationProtocol.Frontend.State>("ui.state")
      return state.screen.includes("Per-Turn Token Breakdown") ? state : undefined
    })
    // Both the category row and its individual setting are searchable.
    expect(palette.screen).toContain("Diagnostics")

    await ui.call("ui.enter")

    const dialog = await eventually(async () => {
      const state = await ui!.call<SimulationProtocol.Frontend.State>("ui.state")
      return state.screen.includes("Diagnostics Settings") ? state : undefined
    })
    expect(dialog.screen).toContain("Per-Turn Token Breakdown")
    // Config-backed and unset in a fresh project, so the row reads OFF.
    expect(dialog.screen).toContain("OFF")

    // Toggling writes `tui.turn_tokens` through the server and pulls the merged
    // config back — the half that a component-level test cannot reach.
    await ui.call("ui.enter")
    await eventually(async () => {
      const state = await ui!.call<SimulationProtocol.Frontend.State>("ui.state")
      return state.screen.includes("enabled") ? state : undefined
    })

    await ui.call("ui.press", { key: "p", modifiers: { ctrl: true } })
    await ui.call("ui.type", { text: "Diagnostics" })
    await ui.call("ui.enter")
    const reopened = await eventually(async () => {
      const state = await ui!.call<SimulationProtocol.Frontend.State>("ui.state")
      return state.screen.includes("Diagnostics Settings") ? state : undefined
    })
    expect(reopened.screen).toContain("Per-Turn Token Breakdown")

    const written = await Bun.file(join(project, "nikcli.json"))
      .json()
      .catch(() => undefined)
    expect(written?.tui?.turn_tokens).toBe(true)
    // Config is cached per instance and invalidated by a watcher, so the row
    // can lag the write by a beat.
    await eventually(async () => ((await ui!.call<boolean>("ui.matches", { text: "ON" })) ? true : undefined))
  } catch (error) {
    child.kill(9)
    await child.exited
    throw new Error(
      `${error instanceof Error ? error.stack : error}\nstdout:\n${await stdout}\nstderr:\n${await stderr}`,
    )
  } finally {
    ui?.close()
    child.kill(9)
    await child.exited
    await rm(root, { recursive: true, force: true })
  }
}, 60_000)
