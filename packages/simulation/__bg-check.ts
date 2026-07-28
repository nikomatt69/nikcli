/** Boot the real nikcli TUI headless with a background image and screenshot it. */
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { connect, type DriverSocket } from "./src/driver"

const nikcli = resolve("/Volumes/SSD/Projects/nikcli/packages/nikcli")
const IMAGE = process.env.BG_IMAGE ?? "/Users/nikoemme-os/Desktop/HOPVd8YXYAAPPGg.jpeg"
const OUT = process.env.OUT ?? "/tmp/claude-501/-Volumes-SSD-Projects-nikcli/19050acc-19e7-481d-b88a-996fa5a61cf7/scratchpad/real-tui.png"

async function freePort() {
  return new Promise<number>((resolvePort, reject) => {
    const probe = createServer()
    probe.once("error", reject)
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address()
      if (!address || typeof address === "string") return reject(new Error("no port"))
      probe.close((error) => (error ? reject(error) : resolvePort(address.port)))
    })
  })
}

async function eventually<T>(fn: () => Promise<T | undefined>, timeoutMs = 40_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const value = await fn()
      if (value !== undefined) return value
    } catch (error) {
      lastError = error
    }
    await Bun.sleep(100)
  }
  throw new Error(`timeout: ${lastError}`)
}

const root = await mkdtemp(join(tmpdir(), "nikcli-bg-"))
const registry = join(root, "registry")
const media = join(root, "media")
const project = join(root, "project")
const home = join(root, "home")
await Promise.all([
  mkdir(registry, { recursive: true }),
  mkdir(media, { recursive: true }),
  mkdir(project),
  mkdir(join(home, "state"), { recursive: true }),
])

// Pre-seed the TUI key-value store the way `/background` would.
await Bun.write(
  join(home, "state", "kv.json"),
  JSON.stringify(
    {
      background_image: {
        source: IMAGE,
        enabled: true,
        opacity: Number(process.env.BG_OPACITY ?? 0.35),
        fit: "cover",
        scope: "home",
        grayscale: false,
      },
    },
    null,
    2,
  ),
)

const [uiPort, backendPort, openaiPort] = await Promise.all([freePort(), freePort(), freePort()])
const manifest = {
  endpoints: {
    ui: `ws://127.0.0.1:${uiPort}`,
    backend: `ws://127.0.0.1:${backendPort}`,
    openai: `http://127.0.0.1:${openaiPort}`,
  },
  viewport: { cols: 120, rows: 34 },
}
await Bun.write(join(registry, "bg.json"), JSON.stringify(manifest))

const child = Bun.spawn(
  [process.execPath, "run", "--conditions=browser", "./src/index.ts", project, "--model", "simulation/deterministic"],
  {
    cwd: nikcli,
    env: {
      ...process.env,
      NIKCLI_BG_DEBUG: "/tmp/claude-501/-Volumes-SSD-Projects-nikcli/19050acc-19e7-481d-b88a-996fa5a61cf7/scratchpad/bg-debug.log",
      NIKCLI_DRIVE: "bg",
      NIKCLI_DRIVE_REGISTRY_DIR: registry,
      NIKCLI_DRIVE_RENDERER: "headless",
      NIKCLI_DRIVE_MEDIA_DIR: media,
      NIKCLI_TEST_HOME: home,
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
try {
  ui = await connect(manifest.endpoints.ui, { timeoutMs: 40_000 })
  const state = await eventually(async () => {
    const value = await ui!.call<{ screen: string }>("ui.state")
    return value.screen.includes("Ask anything") ? value : undefined
  })
  // The image decodes asynchronously; wait until block glyphs actually appear.
  await Bun.sleep(Number(process.env.WAIT_MS ?? 8000))
  const painted = await ui.call<{ screen: string }>("ui.state")
  console.log("--- screen ---")
  console.log(painted.screen)
  const shot = await ui.call<string>("ui.screenshot", { name: "bg" })
  await Bun.write(OUT, Bun.file(shot))
  console.log("screenshot:", OUT)
} catch (error) {
  console.error(error)
  console.error("stdout:", (await stdout).slice(-4000))
  console.error("stderr:", (await stderr).slice(-4000))
} finally {
  ui?.close()
  child.kill(9)
  await child.exited
  if (!process.env.KEEP) await rm(root, { recursive: true, force: true })
  else console.log("root:", root)
}
