import { expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises"
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
  throw new Error("Simulation condition did not become true", {
    cause: lastError,
  })
}

test("drives the real nikcli TUI through a deterministic OpenAI exchange and captures PNG", async () => {
  const root = await mkdtemp(join(tmpdir(), "nikcli-simulation-e2e-"))
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
  await Bun.write(join(registry, "e2e.json"), JSON.stringify(manifest))

  const child = Bun.spawn(
    [process.execPath, "run", "--conditions=browser", "./src/index.ts", project, "--model", "simulation/deterministic"],
    {
      cwd: nikcli,
      env: {
        ...process.env,
        NIKCLI_DRIVE: "e2e",
        NIKCLI_DRIVE_REGISTRY_DIR: registry,
        NIKCLI_DRIVE_RENDERER: "headless",
        NIKCLI_DRIVE_MEDIA_DIR: media,
        NIKCLI_TEST_HOME: join(root, "home"),
        NIKCLI_DISABLE_PROJECT_CONFIG: "1",
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
  let backend: DriverSocket | undefined
  try {
    ;[ui, backend] = await Promise.all([
      connect(manifest.endpoints.ui, { timeoutMs: 30_000 }),
      connect(manifest.endpoints.backend, { timeoutMs: 30_000 }),
    ])
    await backend.call("llm.attach")
    const home = await eventually(async () => {
      const state = await ui!.call<SimulationProtocol.Frontend.State>("ui.state")
      return state.screen.includes("Ask anything") ? state : undefined
    })
    expect(home.screen).toContain("nikcli")
    expect(home.screen).toContain("+ new")

    await ui.call("ui.type", { text: "Reply with the deterministic fixture" })
    await ui.call("ui.enter")

    // The prompt fans out into several exchanges (title generation + the chat
    // turn itself); answer each one deterministically until the reply renders.
    const answered: SimulationProtocol.Backend.OpenedExchange[] = []
    const responder = (async () => {
      while (true) {
        const exchange = await backend!
          .next<SimulationProtocol.Backend.OpenedExchange>("llm.request", 3_000)
          .catch(() => undefined)
        if (!exchange) return
        answered.push(exchange)
        await backend!.call("llm.chunk", {
          id: exchange.id,
          items: [{ type: "textDelta", text: "deterministic fixture reply" }],
        })
        await backend!.call("llm.finish", { id: exchange.id, reason: "stop" })
      }
    })()

    await eventually(async () =>
      (await ui!.call<boolean>("ui.matches", {
        text: "deterministic fixture reply",
      }))
        ? true
        : undefined,
    )
    await responder
    const sessionScreen = await ui.call<SimulationProtocol.Frontend.State>("ui.state")
    // The session view shows the compact logo ("NIK" + "CLI"); the ASCII-art
    // wordmark asserted on the home screen only exists there.
    expect(sessionScreen.screen).toContain("NIKCLI")
    expect(sessionScreen.screen).toContain("×")
    expect(sessionScreen.screen).toContain("+ new")
    expect(
      answered.some((exchange) => {
        const body = exchange.body as {
          model?: unknown
          stream?: unknown
        } | null
        return body?.model === "deterministic" && body?.stream === true
      }),
    ).toBeTrue()
    const screenshot = await ui.call<string>("ui.screenshot", {
      name: "real-tui",
    })
    if (process.env.NIKCLI_E2E_SCREENSHOT_OUT) {
      await Bun.write(process.env.NIKCLI_E2E_SCREENSHOT_OUT, Bun.file(screenshot))
    }
    expect(screenshot).toBe(join(media, "real-tui.png"))
    expect([...(await readFile(screenshot)).subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    const log = await backend.call<{
      entries: SimulationProtocol.Backend.NetworkLogEntry[]
    }>("network.log")
    expect(log.entries.some((entry) => entry.matched && entry.mode === "driver")).toBeTrue()
  } catch (error) {
    child.kill(9)
    await child.exited
    throw new Error(
      `${error instanceof Error ? error.stack : error}\nstdout:\n${await stdout}\nstderr:\n${await stderr}`,
    )
  } finally {
    ui?.close()
    backend?.close()
    child.kill(9)
    await child.exited
    await rm(root, { recursive: true, force: true })
  }
}, 60_000)
