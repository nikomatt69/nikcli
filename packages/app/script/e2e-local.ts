import fs from "node:fs/promises"
import net from "node:net"
import os from "node:os"
import path from "node:path"

async function freePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.once("error", reject)
    server.listen(0, () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to acquire a free port")))
        return
      }
      server.close((err) => {
        if (err) {
          reject(err)
          return
        }
        resolve(address.port)
      })
    })
  })
}

async function waitForHealth(url: string) {
  const timeout = Date.now() + 120_000
  const errors: string[] = []
  while (Date.now() < timeout) {
    const result = await fetch(url)
      .then((r) => ({ ok: r.ok, error: undefined }))
      .catch((error) => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }))
    if (result.ok) return
    if (result.error) errors.push(result.error)
    await new Promise((r) => setTimeout(r, 250))
  }
  const last = errors.length ? ` (last error: ${errors[errors.length - 1]})` : ""
  throw new Error(`Timed out waiting for server health: ${url}${last}`)
}

const appDir = process.cwd()
const repoDir = path.resolve(appDir, "../..")
const nikcliDir = path.join(repoDir, "packages", "nikcli")

const extraArgs = (() => {
  const args = process.argv.slice(2)
  if (args[0] === "--") return args.slice(1)
  return args
})()

const [serverPort, webPort] = await Promise.all([freePort(), freePort()])

const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-e2e-"))

const serverEnv = {
  ...process.env,
  NIKCLI_DISABLE_SHARE: process.env.NIKCLI_DISABLE_SHARE ?? "true",
  NIKCLI_DISABLE_LSP_DOWNLOAD: "true",
  NIKCLI_DISABLE_DEFAULT_PLUGINS: "true",
  NIKCLI_EXPERIMENTAL_DISABLE_FILEWATCHER: "true",
  NIKCLI_TEST_HOME: path.join(sandbox, "home"),
  XDG_DATA_HOME: path.join(sandbox, "share"),
  XDG_CACHE_HOME: path.join(sandbox, "cache"),
  XDG_CONFIG_HOME: path.join(sandbox, "config"),
  XDG_STATE_HOME: path.join(sandbox, "state"),
  NIKCLI_E2E_PROJECT_DIR: repoDir,
  NIKCLI_E2E_SESSION_TITLE: "E2E Session",
  NIKCLI_E2E_MESSAGE: "Seeded for UI e2e",
  NIKCLI_E2E_MODEL: "nikcli/gpt-5-nano",
  NIKCLI_CLIENT: "app",
} satisfies Record<string, string>

const runnerEnv = {
  ...serverEnv,
  PLAYWRIGHT_SERVER_HOST: "127.0.0.1",
  PLAYWRIGHT_SERVER_PORT: String(serverPort),
  VITE_NIKCLI_SERVER_HOST: "127.0.0.1",
  VITE_NIKCLI_SERVER_PORT: String(serverPort),
  PLAYWRIGHT_PORT: String(webPort),
} satisfies Record<string, string>

const seed = Bun.spawn(["bun", "script/seed-e2e.ts"], {
  cwd: nikcliDir,
  env: serverEnv,
  stdout: "inherit",
  stderr: "inherit",
})

const seedExit = await seed.exited
if (seedExit !== 0) {
  process.exit(seedExit)
}

Object.assign(process.env, serverEnv)
process.env.AGENT = "1"
process.env.NIKCLI = "1"

const log = await import("../../nikcli/src/util/log")
const install = await import("../../nikcli/src/installation")
await log.Log.init({
  print: true,
  dev: install.Installation.isLocal(),
  level: "WARN",
})

const servermod = await import("../../nikcli/src/server/server")
const inst = await import("../../nikcli/src/project/instance")
const server = servermod.Server.listen({ port: serverPort, hostname: "127.0.0.1" })
console.log(`nikcli server listening on http://127.0.0.1:${serverPort}`)

const result = await (async () => {
  try {
    await waitForHealth(`http://127.0.0.1:${serverPort}/global/health`)

    const runner = Bun.spawn(["bun", "test:e2e", ...extraArgs], {
      cwd: appDir,
      env: runnerEnv,
      stdout: "inherit",
      stderr: "inherit",
    })

    return { code: await runner.exited }
  } catch (error) {
    return { error }
  } finally {
    await inst.Instance.disposeAll()
    await server.stop()
  }
})()

if ("error" in result) {
  console.error(result.error)
  process.exit(1)
}

process.exit(result.code)
