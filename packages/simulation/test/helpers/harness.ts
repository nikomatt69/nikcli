import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { connect, type DriverSocket } from "../../src/driver"
import type { SimulationProtocol } from "../../src/protocol"

const nikcli = resolve(import.meta.dir, "../../../nikcli")

async function freePort() {
  return new Promise<number>((resolvePort, reject) => {
    const probe = createServer()
    probe.once("error", reject)
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address()
      if (!address || typeof address === "string") {
        probe.close()
        reject(new Error("Unable to allocate simulation port"))
        return
      }
      probe.close((error) => (error ? reject(error) : resolvePort(address.port)))
    })
  })
}

export async function eventually<T>(fn: () => Promise<T | undefined>, timeoutMs = 20_000): Promise<T> {
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

export interface Harness {
  readonly ui: DriverSocket
  readonly backend: DriverSocket
  /**
   * The project the CLI was started in. Scenarios that exercise tools write
   * their fixtures here: a path outside it trips the "external directory"
   * permission prompt, which is a different render path entirely.
   */
  readonly projectDir: string
  /** The rendered screen, as text. */
  screen(): Promise<string>
  /** Type into the prompt and submit. */
  send(text: string): Promise<void>
  /**
   * Answer every LLM exchange the CLI opens until it stops asking.
   *
   * A prompt fans out into several exchanges — title generation, summarising,
   * and the chat turn itself. The chat turn is the one that carries the tool
   * definitions; the others carry none. Matching on that rather than on
   * arrival order is what keeps a scenario's script landing on the message
   * instead of on the thread title.
   */
  respond(items: readonly SimulationProtocol.Backend.Item[], reason?: string, continuation?: string): Promise<void>
  waitFor(text: string, timeoutMs?: number): Promise<void>
  close(): Promise<void>
}

/**
 * Boot the real nikcli TUI headless, wired to the simulation's deterministic
 * OpenAI backend, and return a driver for it.
 *
 * Extracted from `e2e.test.ts` so a corpus of render scenarios can reuse it
 * rather than each copying twenty lines of process wiring.
 */
export async function start(
  options: { cols?: number; rows?: number; experimental?: Record<string, unknown> } = {},
): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "nikcli-render-"))
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
    viewport: { cols: options.cols ?? 100, rows: options.rows ?? 30 },
  }
  await Bun.write(join(registry, "render.json"), JSON.stringify(manifest))
  if (options.experimental) {
    // The global config, not the project one: the harness sets
    // NIKCLI_DISABLE_PROJECT_CONFIG so a developer's own project settings can
    // never reach a golden, and that switch would swallow this too. XDG_CONFIG_HOME
    // points inside the run's temp root, so this stays isolated.
    // NIKCLI_TEST_HOME wins over XDG for every Global.Path, so the global
    // config lives at <test home>/config/nikcli.json.
    await Bun.write(join(root, "home", "config", "nikcli.json"), JSON.stringify({ experimental: options.experimental }))
  }

  const child = Bun.spawn(
    [process.execPath, "run", "--conditions=browser", "./src/index.ts", project, "--model", "simulation/deterministic"],
    {
      cwd: nikcli,
      env: {
        ...process.env,
        NIKCLI_DRIVE: "render",
        NIKCLI_DRIVE_REGISTRY_DIR: registry,
        NIKCLI_DRIVE_RENDERER: "headless",
        NIKCLI_DRIVE_MEDIA_DIR: media,
        NIKCLI_TEST_HOME: join(root, "home"),
        NIKCLI_DISABLE_PROJECT_CONFIG: "1",
        NIKCLI_DISABLE_DEFAULT_PLUGINS: "1",
        // The editor bridge is discovered through ~/.claude/ide, which the
        // temp home does not shadow — without this the CLI attaches to the
        // developer's editor and prepends their current selection to the
        // prompt, which then lands in a golden screen.
        NIKCLI_DISABLE_EDITOR_CONTEXT: "1",
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
  // Drained so the child never blocks on a full pipe.
  void new Response(child.stdout).text()
  void new Response(child.stderr).text()

  const [ui, backend] = await Promise.all([
    connect(manifest.endpoints.ui, { timeoutMs: 30_000 }),
    connect(manifest.endpoints.backend, { timeoutMs: 30_000 }),
  ])
  await backend.call("llm.attach")
  await eventually(async () => {
    const state = await ui.call<SimulationProtocol.Frontend.State>("ui.state")
    return state.screen.includes("Ask anything") ? state : undefined
  })

  return {
    ui,
    backend,
    projectDir: project,
    async screen() {
      const state = await ui.call<SimulationProtocol.Frontend.State>("ui.state")
      return state.screen
    },
    async send(text) {
      await ui.call("ui.type", { text })
      await ui.call("ui.enter")
    },
    async respond(items, reason = "stop", continuation = "Done.") {
      let scripted = false
      while (true) {
        const exchange = await backend
          .next<SimulationProtocol.Backend.OpenedExchange>("llm.request", 3_000)
          .catch(() => undefined)
        if (!exchange) return
        const body = exchange.body as { tools?: unknown[] } | null
        if (Array.isArray(body?.tools) && body.tools.length > 0) {
          if (!scripted) {
            scripted = true
            await backend.call("llm.chunk", { id: exchange.id, items })
            await backend.call("llm.finish", { id: exchange.id, reason })
            continue
          }
          // The script is one assistant turn. After the tools run the engine
          // opens a continuation exchange — replying with the same tool calls
          // would loop forever, so it gets a terminating reply.
          await backend.call("llm.chunk", { id: exchange.id, items: [{ type: "textDelta", text: continuation }] })
          await backend.call("llm.finish", { id: exchange.id, reason: "stop" })
          continue
        }
        // Title generation and summarising carry no tools. They get something
        // short and constant so they cannot perturb the golden.
        await backend.call("llm.chunk", { id: exchange.id, items: [{ type: "textDelta", text: "Fixture" }] })
        await backend.call("llm.finish", { id: exchange.id, reason: "stop" })
      }
    },
    async waitFor(text, timeoutMs = 20_000) {
      await eventually(async () => ((await ui.call<boolean>("ui.matches", { text })) ? true : undefined), timeoutMs)
    },
    async close() {
      ui.close()
      backend.close()
      child.kill(9)
      await child.exited
      await rm(root, { recursive: true, force: true })
    },
  }
}

/**
 * Strip everything that changes between runs, so a golden captures the
 * *layout and content* of a render rather than the clock it ran on.
 *
 * Anything left volatile here would make the corpus flaky, and a flaky golden
 * is worse than no golden — it trains you to ignore the diff.
 */
export function normalize(screen: string): string {
  return (
    screen
      // ids
      .replace(/\b(ses|msg|prt|evt|syn|tsk)_[A-Za-z0-9]+/g, "$1_X")
      // durations and elapsed times: 1.2s, 340ms, 1m 2s
      .replace(/\b\d+(\.\d+)?\s?(ms|s|m|h)\b/g, "Ns")
      // token and cost readouts
      .replace(/\$\d+(\.\d+)?/g, "$X")
      .replace(/\b\d[\d,.]*[KMk]?\s+tokens?\b/gi, "N tokens")
      .replace(/\b\d[\d,.]*\s?tok\/s\b/gi, "N tok/s")
      // absolute paths from the temp project
      .replace(/\/(?:private\/)?(?:var|tmp)\/[^\s"']*/g, "/TMP")
      // clock times
      .replace(/\b\d{1,2}:\d{2}(:\d{2})?\s?(AM|PM)?\b/gi, "HH:MM")
      // The status bar ends with the file the developer's editor has open
      // (nikcli's IDE integration), right-aligned — so its *length* shifts the
      // whole line, not just its tail. Harmless in the product, poison in a
      // golden: the corpus would depend on which file the developer had open.
      // The line is chrome, not the session render, so it goes whole.
      .replace(/^.*ctrl\+p commands.*$/gm, "[status bar]")
      // trailing whitespace per line — invisible, and it churns
      .split("\n")
      .map((line) => line.replace(/\s+$/, ""))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  )
}
