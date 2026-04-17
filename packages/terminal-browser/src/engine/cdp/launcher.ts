import { mkdtemp, readFile, rm, stat } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"

const MAC_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
]

const LINUX_BINARIES = ["google-chrome-stable", "google-chrome", "chromium", "chromium-browser", "chrome"]

async function fileExists(path: string) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function which(binary: string) {
  const result = Bun.spawnSync({
    cmd: ["/usr/bin/env", "which", binary],
    stdout: "pipe",
    stderr: "ignore",
  })
  if (result.exitCode !== 0) return null
  const output = result.stdout.toString().trim()
  return output || null
}

export async function findInstalledBrowserPath(explicitPath?: string) {
  const candidates = [
    explicitPath,
    process.env.NIKCLI_BROWSER_PATH,
    process.env.CHROME_PATH,
    process.env.BROWSER?.includes("/") ? process.env.BROWSER : which(process.env.BROWSER ?? ""),
    ...(process.platform === "darwin" ? MAC_PATHS : []),
    ...(process.platform === "linux" ? LINUX_BINARIES.map((binary) => which(binary)).filter(Boolean) : []),
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate
  }

  return null
}

async function waitForDevToolsPort(userDataDir: string, timeoutMs = 8000) {
  const startedAt = Date.now()
  const file = join(userDataDir, "DevToolsActivePort")

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const contents = await readFile(file, "utf8")
      const [port] = contents.trim().split("\n")
      if (port) return Number(port)
    } catch {}
    await Bun.sleep(100)
  }

  throw new Error("Timed out waiting for Chromium DevToolsActivePort")
}

async function waitForPageTarget(port: number, timeoutMs = 8000) {
  const startedAt = Date.now()
  const baseUrl = `http://127.0.0.1:${port}`

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/json/list`)
      const targets = (await response.json()) as Array<{ type?: string; webSocketDebuggerUrl?: string }>
      const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl)
      if (page?.webSocketDebuggerUrl) {
        return { baseUrl, webSocketDebuggerUrl: page.webSocketDebuggerUrl }
      }
    } catch {}
    await Bun.sleep(100)
  }

  throw new Error("Timed out waiting for Chromium page target")
}

async function readStderr(process: Bun.Subprocess<"ignore", "pipe", "inherit">) {
  if (!process.stderr) return ""
  const chunks: Uint8Array[] = []
  const reader = process.stderr.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) chunks.push(value)
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8")
}

export async function launchChromiumSession(browserPath?: string) {
  const executable = await findInstalledBrowserPath(browserPath)
  if (!executable) {
    throw new Error("Chrome/Chromium not found on this machine")
  }

  const userDataDir = await mkdtemp(join(tmpdir(), "nikcli-terminal-browser-"))
  const args = [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-breakpad",
    "--disable-client-side-phishing-detection",
    "--disable-default-apps",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--disable-renderer-backgrounding",
    "--enable-automation",
    "--hide-scrollbars",
    "--metrics-recording-only",
    "--mute-audio",
    "--no-default-browser-check",
    "--no-first-run",
    "--password-store=basic",
    "--use-mock-keychain",
    "about:blank",
  ]

  const process = Bun.spawn({
    cmd: [executable, ...args],
    stdout: "ignore",
    stderr: "pipe",
    stdin: "ignore",
  })

  const stderrTask = readStderr(process)

  try {
    const port = await waitForDevToolsPort(userDataDir)
    const target = await waitForPageTarget(port)

    return {
      executable,
      process,
      userDataDir,
      baseUrl: target.baseUrl,
      webSocketDebuggerUrl: target.webSocketDebuggerUrl,
      async dispose() {
        process.kill()
        await process.exited
        await rm(userDataDir, { recursive: true, force: true })
      },
      async readStderr() {
        return stderrTask
      },
    }
  } catch (error) {
    process.kill()
    await process.exited
    const stderr = await stderrTask.catch(() => "")
    await rm(userDataDir, { recursive: true, force: true })
    throw new Error(`${error instanceof Error ? error.message : String(error)}${stderr ? `\n${stderr}` : ""}`)
  }
}
