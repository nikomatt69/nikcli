import { Log } from "@/util/log"
import { Schema } from "effect"
import { zodObject } from "@/util/effect-zod"

const log = Log.create({ service: "expo" })

export namespace Expo {
  const StartOptionsSchema = Schema.Struct({
    platform: Schema.optional(Schema.Literal("ios", "android", "web")),
    clear: Schema.optional(Schema.Boolean),
    port: Schema.optional(Schema.Number),
  })
  export const StartOptions = zodObject(StartOptionsSchema)
  export type StartOptions = Schema.Schema.Type<typeof StartOptionsSchema>

  const BuildOptionsSchema = Schema.Struct({
    platform: Schema.Literal("ios", "android", "all"),
    profile: Schema.optional(Schema.String),
    clearCache: Schema.optional(Schema.Boolean),
  })
  export const BuildOptions = zodObject(BuildOptionsSchema)
  export type BuildOptions = Schema.Schema.Type<typeof BuildOptionsSchema>

  export async function available(): Promise<boolean> {
    return (await Bun.which("npx")) !== null
  }

  async function exec(args: string[], opts?: { cwd?: string; timeout?: number }): Promise<string> {
    const proc = Bun.spawn(["npx", ...args], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: opts?.cwd,
      env: process.env as Record<string, string>,
    })

    const timeout = opts?.timeout ?? 120000
    const timer = setTimeout(() => proc.kill(), timeout)
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    clearTimeout(timer)

    if (exitCode !== 0) {
      throw new Error(stderr.trim() || stdout.trim() || `npx ${args.join(" ")} exited with code ${exitCode}`)
    }

    return stdout.trim()
  }

  export async function version(): Promise<string> {
    try {
      const output = await exec(["expo", "--version"], { timeout: 10000 })
      return output
    } catch {
      return "not available"
    }
  }

  export async function start(opts: StartOptions & { cwd?: string }): Promise<{
    url: string
    pid: number
  }> {
    const args = ["expo", "start"]
    if (opts.platform) args.push("--", `--${opts.platform}`)
    if (opts.clear) args.push("--clear")
    if (opts.port) args.push("--port", String(opts.port))

    const proc = Bun.spawn(["npx", ...args], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: opts.cwd,
      env: process.env as Record<string, string>,
    })

    const stdout = proc.stdout
    const reader = stdout.getReader()
    const decoder = new TextDecoder()
    let output = ""
    let url = ""

    const timeoutMs = 30000
    const startTime = Date.now()

    while (Date.now() - startTime < timeoutMs) {
      const { done, value } = await reader.read()
      if (done) break
      const text = decoder.decode(value)
      output += text

      const urlMatch = output.match(/exp:\/\/[\d.]+:\d+/)
      if (urlMatch) {
        url = urlMatch[0]
        break
      }

      const metroMatch = output.match(/Metro waiting on (exp:\/\/[^\s]+)/)
      if (metroMatch) {
        url = metroMatch[1]
        break
      }
    }

    reader.releaseLock()

    if (!url) {
      const urlMatch = output.match(/exp:\/\/[\d.]+:\d+/)
      url = urlMatch?.[0] ?? `http://localhost:${opts.port ?? 8081}`
    }

    log.info("expo dev server started", { url, pid: proc.pid })

    return { url, pid: proc.pid ?? 0 }
  }

  export async function build(opts: BuildOptions & { cwd?: string }): Promise<string> {
    const args = ["eas", "build", "--non-interactive"]
    args.push("--platform", opts.platform)
    if (opts.profile) args.push("--profile", opts.profile)
    if (opts.clearCache) args.push("--clear-cache")

    const output = await exec(args, { cwd: opts.cwd, timeout: 600000 })
    log.info("eas build completed", { platform: opts.platform, profile: opts.profile })
    return output
  }

  export async function installPackages(packages: string[], opts?: { cwd?: string }): Promise<string> {
    const args = ["expo", "install", ...packages]
    const output = await exec(args, { cwd: opts?.cwd, timeout: 120000 })
    log.info("expo install completed", { packages })
    return output
  }

  export async function publish(opts?: { message?: string; cwd?: string }): Promise<string> {
    const args = ["expo", "publish"]
    if (opts?.message) args.push("--message", opts.message)
    const output = await exec(args, { cwd: opts?.cwd, timeout: 120000 })
    log.info("expo publish completed")
    return output
  }

  export async function listProfiles(opts?: { cwd?: string }): Promise<string[]> {
    try {
      const proc = Bun.spawn(["npx", "eas", "build:list", "--json", "--limit", "0"], {
        stdout: "pipe",
        stderr: "pipe",
        cwd: opts?.cwd,
        env: process.env as Record<string, string>,
      })
      const [exitCode, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()])
      if (exitCode === 0) {
        const data = JSON.parse(stdout)
        if (Array.isArray(data)) {
          const profiles = new Set<string>()
          for (const item of data) {
            if (item.buildProfile) profiles.add(item.buildProfile)
          }
          return [...profiles]
        }
      }
    } catch {}
    return []
  }

  export async function doctor(opts?: { cwd?: string }): Promise<{
    expoCli: boolean
    easCli: boolean
    nodeVersion: string
    details: string[]
  }> {
    const details: string[] = []
    let expoCli = false
    let easCli = false
    let nodeVersion = ""

    try {
      const nodeProc = Bun.spawn(["node", "--version"], { stdout: "pipe", stderr: "pipe" })
      const [nodeCode, nodeOut] = await Promise.all([nodeProc.exited, new Response(nodeProc.stdout).text()])
      if (nodeCode === 0) {
        nodeVersion = nodeOut.trim()
        details.push(`Node.js: ${nodeVersion}`)
      }
    } catch {
      details.push("Node.js: not found")
    }

    try {
      const expoVersion = await version()
      expoCli = expoVersion !== "not available"
      details.push(`Expo CLI: ${expoCli ? expoVersion : "not installed"}`)
    } catch {
      details.push("Expo CLI: not installed")
    }

    try {
      const proc = Bun.spawn(["npx", "eas", "--version"], {
        stdout: "pipe",
        stderr: "pipe",
        cwd: opts?.cwd,
        env: process.env as Record<string, string>,
      })
      const [exitCode, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()])
      if (exitCode === 0) {
        easCli = true
        details.push(`EAS CLI: ${stdout.trim()}`)
      } else {
        details.push("EAS CLI: not installed")
      }
    } catch {
      details.push("EAS CLI: not installed")
    }

    return { expoCli, easCli, nodeVersion, details }
  }
}
