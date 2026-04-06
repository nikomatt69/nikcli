import z from "zod"
import { Log } from "@/util/log"

const log = Log.create({ service: "react-native" })

export namespace ReactNative {
  export const RunOptions = z.object({
    platform: z.enum(["ios", "android"]),
    device: z.string().optional(),
    configuration: z.string().optional(),
  })
  export type RunOptions = z.infer<typeof RunOptions>

  async function exec(args: string[], opts?: { cwd?: string; timeout?: number }): Promise<string> {
    const proc = Bun.spawn(["npx", ...args], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: opts?.cwd,
      env: process.env as Record<string, string>,
    })

    const timeout = opts?.timeout ?? 300000
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

  export async function available(): Promise<boolean> {
    return (await Bun.which("npx")) !== null
  }

  export async function version(): Promise<string> {
    try {
      const output = await exec(["react-native", "--version"], { timeout: 10000 })
      return output.split("\n")[0].trim()
    } catch {
      return "not available"
    }
  }

  export async function runIOS(opts: RunOptions & { cwd?: string }): Promise<string> {
    const args = ["react-native", "run-ios"]
    if (opts.device) args.push("--device", opts.device)
    if (opts.configuration) args.push("--configuration", opts.configuration)

    const output = await exec(args, { cwd: opts.cwd, timeout: 600000 })
    log.info("react-native run-ios completed", { device: opts.device })
    return output
  }

  export async function runAndroid(opts: RunOptions & { cwd?: string }): Promise<string> {
    const args = ["react-native", "run-android"]
    if (opts.device) args.push("--deviceId", opts.device)
    if (opts.configuration) args.push("--variant", opts.configuration)

    const output = await exec(args, { cwd: opts.cwd, timeout: 600000 })
    log.info("react-native run-android completed", { device: opts.device })
    return output
  }

  export async function run(opts: RunOptions & { cwd?: string }): Promise<string> {
    return opts.platform === "ios" ? runIOS(opts) : runAndroid(opts)
  }

  export async function startMetro(opts?: { port?: number; cwd?: string }): Promise<{
    url: string
    pid: number
  }> {
    const args = ["react-native", "start"]
    if (opts?.port) args.push("--port", String(opts.port))

    const proc = Bun.spawn(["npx", ...args], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: opts?.cwd,
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

      const match = output.match(/Metro waiting on (exp:\/\/[^\s]+)/)
      if (match) {
        url = match[1]
        break
      }

      const simpleMatch = output.match(/http:\/\/localhost:\d+/)
      if (simpleMatch) {
        url = simpleMatch[0]
        break
      }
    }

    reader.releaseLock()

    if (!url) {
      url = `http://localhost:${opts?.port ?? 8081}`
    }

    log.info("metro bundler started", { url, pid: proc.pid })

    return { url, pid: proc.pid ?? 0 }
  }
}
