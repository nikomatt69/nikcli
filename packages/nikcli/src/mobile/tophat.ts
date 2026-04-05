import { unlinkSync } from "fs"
import z from "zod"
import { Log } from "@/util/log"
import { Config } from "@/config/config"
import os from "os"

const log = Log.create({ service: "tophat" })

export namespace Tophat {
  const DeviceInfo = z
    .object({
      name: z.string(),
      platform: z.enum(["iOS", "android"]),
      runtimeVersion: z.string().optional(),
      state: z.string().optional(),
    })
    .strict()

  const ProviderInfo = z
    .object({
      id: z.string(),
    })
    .strict()

  const ListOutput = z.object({
    apps: z.array(z.unknown()).optional(),
    devices: DeviceInfo.array().optional(),
    providers: ProviderInfo.array().optional(),
  })

  export type Device = z.infer<typeof DeviceInfo>
  export type Provider = z.infer<typeof ProviderInfo>
  export type ListResult = z.infer<typeof ListOutput>

  const Recipe = z.object({
    artifactProviderID: z.string().optional(),
    artifactProviderParameters: z.record(z.string(), z.string()).optional(),
    launchArguments: z.array(z.string()).optional(),
    platformHint: z.enum(["iOS", "android"]).optional(),
    destinationHint: z.enum(["device", "simulator", "emulator"]).optional(),
    url: z.string().url().optional(),
    path: z.string().optional(),
  })

  export type Recipe = z.infer<typeof Recipe>

  const QuickLaunchEntry = z.object({
    id: z.string(),
    name: z.string(),
    recipes: Recipe.array(),
  })

  export type QuickLaunchEntry = z.infer<typeof QuickLaunchEntry>

  async function resolveCliPath(): Promise<string | null> {
    const config = await Config.get().catch(() => undefined)
    if (config?.mobile?.tophat?.cliPath) {
      return config.mobile.tophat.cliPath
    }
    return await Bun.which("tophatctl")
  }

  export async function available(): Promise<boolean> {
    return (await resolveCliPath()) !== null
  }

  export async function cliPath(): Promise<string | null> {
    return resolveCliPath()
  }

  async function exec(args: string[], opts?: { timeout?: number }): Promise<string> {
    const bin = await resolveCliPath()
    if (!bin) {
      throw new Error("tophatctl is not installed. Install Tophat from https://github.com/Shopify/tophat")
    }

    const proc = Bun.spawn([bin, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      env: process.env as Record<string, string>,
    })

    const timeout = opts?.timeout ?? 30000
    const timer = setTimeout(() => proc.kill(), timeout)
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    clearTimeout(timer)

    if (exitCode !== 0) {
      throw new Error(stderr.trim() || stdout.trim() || `tophatctl ${args.join(" ")} exited with code ${exitCode}`)
    }

    return stdout.trim()
  }

  export async function status(): Promise<{
    available: boolean
    cliPath: string | null
    providers: Provider[]
    devices: Device[]
    macos: boolean
  }> {
    const bin = await resolveCliPath()
    if (!bin) {
      return { available: false, cliPath: null, providers: [], devices: [], macos: os.platform() === "darwin" }
    }

    try {
      const [raw, rawDevices] = await Promise.all([
        exec(["list", "providers", "--json"]),
        exec(["list", "devices", "--json"]),
      ])
      const providersResult = ListOutput.safeParse(JSON.parse(raw))
      const providers = providersResult.success ? (providersResult.data.providers ?? []) : []
      const devicesResult = ListOutput.safeParse(JSON.parse(rawDevices))
      const devices = devicesResult.success ? (devicesResult.data.devices ?? []) : []

      return {
        available: true,
        cliPath: bin,
        providers,
        devices,
        macos: os.platform() === "darwin",
      }
    } catch (error) {
      log.warn("tophatctl status failed", { error })
      return { available: true, cliPath: bin, providers: [], devices: [], macos: os.platform() === "darwin" }
    }
  }

  export function installUrl(artifactUrl: string, options?: { platform?: string; destination?: string }): string {
    const params = new URLSearchParams()
    params.set("url", artifactUrl)
    if (options?.platform) params.set("platform", options.platform)
    if (options?.destination) params.set("destination", options.destination)
    return `tophat://install/http?${params.toString()}`
  }

  export function localInstallUrl(artifactUrl: string, options?: { platform?: string }): string {
    const params = new URLSearchParams()
    params.set("url", artifactUrl)
    if (options?.platform) params.set("platform", options.platform)
    return `http://localhost:29070/install/http?${params.toString()}`
  }

  export async function install(input: {
    path?: string
    url?: string
    recipe?: Recipe
    platform?: string
    destination?: string
  }): Promise<void> {
    if (input.recipe) {
      const recipeJson = JSON.stringify(input.recipe)
      await exec(["install", recipeJson])
      return
    }

    const recipe: Recipe = {}

    if (input.path) {
      recipe.path = input.path
    } else if (input.url) {
      recipe.url = input.url
      recipe.artifactProviderID = "http"
      recipe.artifactProviderParameters = { url: input.url }
    }

    if (input.platform) {
      recipe.platformHint = (input.platform === "ios" ? "iOS" : "android") as "iOS" | "android"
    }
    if (input.destination) {
      recipe.destinationHint = input.destination as "device" | "simulator" | "emulator"
    }

    const target = input.path ?? input.url ?? ""
    const recipeJson = JSON.stringify(recipe)
    await exec(["install", recipeJson])
    log.info("installed", { target, platform: input.platform, destination: input.destination })
  }

  export function quickLaunchConfig(entry: QuickLaunchEntry): string {
    return JSON.stringify(entry, null, 2)
  }

  export async function syncQuickLaunch(entries: QuickLaunchEntry[]): Promise<void> {
    if (!entries.length) return
    for (const entry of entries) {
      const config = quickLaunchConfig(entry)
      const tmpFile = `${os.tmpdir()}/tophat-ql-${entry.id}.json`
      await Bun.write(tmpFile, config)
      try {
        await exec(["apps", "add", tmpFile])
        log.info("synced quick launch", { id: entry.id, name: entry.name })
      } finally {
        unlinkSync(tmpFile)
      }
    }
  }
}
