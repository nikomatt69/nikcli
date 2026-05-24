import { BusEvent } from "@/bus/bus-event"
import path from "path"
import { $ } from "bun"
import z from "zod"
import { Log } from "../util/log"
import { iife } from "@/util/iife"
import { Flag } from "../flag/flag"
import { zodObject } from "@/util/effect-zod"
import { Context, Effect, Layer, Schema } from "effect"

declare global {
  const NIKCLI_VERSION: string
  const NIKCLI_CHANNEL: string
}

export namespace Installation {
  const log = Log.create({ service: "installation" })

  export type Method = "curl" | "npm" | "yarn" | "pnpm" | "bun" | "brew" | "scoop" | "choco" | "unknown"

  export const Event = {
    Updated: BusEvent.define(
      "installation.updated",
      z.object({
        version: z.string(),
      }),
    ),
    UpdateAvailable: BusEvent.define(
      "installation.update-available",
      z.object({
        version: z.string(),
      }),
    ),
  }

  const InfoSchema = Schema.Struct({
    version: Schema.String,
    latest: Schema.String,
  }).annotate({ identifier: "InstallationInfo" })
  export const Info = zodObject(InfoSchema)
  export type Info = Schema.Schema.Type<typeof InfoSchema>

  export class Service extends Context.Service<
    Service,
    {
      info(): Effect.Effect<Info, unknown>
      method(): Effect.Effect<Method, unknown>
      latest(installMethod?: Method): Effect.Effect<string, unknown>
      upgrade(method: Method, target: string): Effect.Effect<void, unknown>
    }
  >()("Installation.Service") {}

  export const layer = Layer.succeed(
    Service,
    Service.of({
      info: () => Effect.tryPromise(() => infoImpl()),
      method: () => Effect.tryPromise(() => methodImpl()),
      latest: (installMethod) => Effect.tryPromise(() => latestImpl(installMethod)),
      upgrade: (method, target) => Effect.tryPromise(() => upgradeImpl(method, target)),
    }),
  )

  export const defaultLayer = layer

  async function infoImpl() {
    return {
      version: VERSION,
      latest: await latestImpl(),
    }
  }

  export function isPreview() {
    return CHANNEL !== "latest"
  }

  export function isLocal() {
    return CHANNEL === "local"
  }

  async function methodImpl(): Promise<Method> {
    if (process.execPath.includes(path.join(".nikcli", "bin"))) return "curl"
    if (process.execPath.includes(path.join(".local", "bin"))) return "curl"
    const exec = process.execPath.toLowerCase()

    const checks = [
      {
        name: "npm" as const,
        command: () => $`npm list -g --depth=0`.throws(false).quiet().text(),
      },
      {
        name: "yarn" as const,
        command: () => $`yarn global list`.throws(false).quiet().text(),
      },
      {
        name: "pnpm" as const,
        command: () => $`pnpm list -g --depth=0`.throws(false).quiet().text(),
      },
      {
        name: "bun" as const,
        command: () => $`bun pm ls -g`.throws(false).quiet().text(),
      },
      {
        name: "brew" as const,
        command: () => $`brew list --formula nikcli`.throws(false).quiet().text(),
      },
      {
        name: "scoop" as const,
        command: () => $`scoop list nikcli`.throws(false).quiet().text(),
      },
      {
        name: "choco" as const,
        command: () => $`choco list --limit-output nikcli`.throws(false).quiet().text(),
      },
    ]

    checks.sort((a, b) => {
      const aMatches = exec.includes(a.name)
      const bMatches = exec.includes(b.name)
      if (aMatches && !bMatches) return -1
      if (!aMatches && bMatches) return 1
      return 0
    })

    for (const check of checks) {
      const output = await check.command()
      const installedName =
        check.name === "brew" || check.name === "choco" || check.name === "scoop" ? "nikcli" : "nikcli-ai"
      if (output.includes(installedName)) {
        return check.name
      }
    }

    return "unknown"
  }

  export class UpgradeFailedError extends Schema.TaggedErrorClass<UpgradeFailedError>()("UpgradeFailedError", {
    stderr: Schema.String,
  }) {}

  async function getBrewFormula() {
    const tapFormula = await $`brew list --formula nikomatt69/tap/nikcli`.throws(false).quiet().text()
    if (tapFormula.includes("nikcli")) return "nikomatt69/tap/nikcli"
    const coreFormula = await $`brew list --formula nikcli`.throws(false).quiet().text()
    if (coreFormula.includes("nikcli")) return "nikcli"
    return "nikcli"
  }

  async function upgradeImpl(method: Method, target: string) {
    let cmd
    switch (method) {
      case "curl":
        cmd = $`curl -fsSL https://nikcli.store/install | bash`.env({
          ...process.env,
          VERSION: target,
        })
        break
      case "npm":
        cmd = $`npm install -g nikcli-ai@${target}`
        break
      case "pnpm":
        cmd = $`pnpm install -g nikcli-ai@${target}`
        break
      case "bun":
        cmd = $`bun install -g nikcli-ai@${target}`
        break
      case "brew": {
        const formula = await getBrewFormula()
        cmd = $`brew upgrade ${formula}`.env({
          HOMEBREW_NO_AUTO_UPDATE: "1",
          ...process.env,
        })
        break
      }
      case "choco":
        cmd = $`echo Y | choco upgrade nikcli --version=${target}`
        break
      case "scoop":
        cmd = $`scoop install nikcli@${target}`
        break
      default:
        throw new Error(`Unknown method: ${method}`)
    }
    const result = await cmd.quiet().throws(false)
    if (result.exitCode !== 0) {
      const stderr = method === "choco" ? "not running from an elevated command shell" : result.stderr.toString("utf8")
      throw new UpgradeFailedError({
        stderr: stderr,
      })
    }
    log.info("upgraded", {
      method,
      target,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    })
    await $`${process.execPath} --version`.nothrow().quiet().text()
  }

  export const VERSION = typeof NIKCLI_VERSION === "string" ? NIKCLI_VERSION : "local"
  export const CHANNEL = typeof NIKCLI_CHANNEL === "string" ? NIKCLI_CHANNEL : "local"
  export const USER_AGENT = `nikcli/${CHANNEL}/${VERSION}/${Flag.NIKCLI_CLIENT}`

  export function getReleaseType(current: string, latest: string): "major" | "minor" | "patch" {
    const parse = (v: string) => v.replace(/^v/, "").split(".").map(Number)
    const [curMaj, curMin] = parse(current)
    const [latMaj, latMin] = parse(latest)
    if (latMaj > curMaj) return "major"
    if (latMin > curMin) return "minor"
    return "patch"
  }

  async function latestImpl(installMethod?: Method) {
    const detectedMethod = installMethod || (await methodImpl())

    if (detectedMethod === "brew") {
      const formula = await getBrewFormula()
      if (formula === "nikcli") {
        // Core Homebrew formula — check brew.sh API
        try {
          const data: any = await fetch("https://formulae.brew.sh/api/formula/nikcli.json").then((res) => {
            if (!res.ok) throw new Error(res.statusText)
            return res.json()
          })
          return data.versions.stable
        } catch {
          // Core formula not found on brew.sh — fall through to GitHub releases
          log.info("brew core formula not found on brew.sh, falling back to GitHub releases")
        }
      }
      // Tap formula (nikomatt69/tap/nikcli) — always check GitHub releases
      // since the tap just mirrors GitHub release assets
    }

    if (detectedMethod === "npm" || detectedMethod === "bun" || detectedMethod === "pnpm") {
      const registry = await iife(async () => {
        const r = (await $`npm config get registry`.quiet().nothrow().text()).trim()
        const reg = r || "https://registry.npmjs.org"
        return reg.endsWith("/") ? reg.slice(0, -1) : reg
      })
      const channel = CHANNEL
      return fetch(`${registry}/nikcli-ai/${channel}`)
        .then((res) => {
          if (!res.ok) throw new Error(res.statusText)
          return res.json()
        })
        .then((data: any) => data.version)
    }

    if (detectedMethod === "choco") {
      return fetch(
        "https://community.chocolatey.org/api/v2/Packages?$filter=Id%20eq%20%27nikcli%27%20and%20IsLatestVersion&$select=Version",
        { headers: { Accept: "application/json;odata=verbose" } },
      )
        .then((res) => {
          if (!res.ok) throw new Error(res.statusText)
          return res.json()
        })
        .then((data: any) => data.d.results[0].Version)
    }

    if (detectedMethod === "scoop") {
      return fetch("https://raw.githubusercontent.com/ScoopInstaller/Main/master/bucket/nikcli.json", {
        headers: { Accept: "application/json" },
      })
        .then((res) => {
          if (!res.ok) throw new Error(res.statusText)
          return res.json()
        })
        .then((data: any) => data.version)
    }

    return fetch("https://api.github.com/repos/nikomatt69/nikcli/releases/latest")
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText)
        return res.json()
      })
      .then((data: any) => data.tag_name.replace(/^v/, ""))
  }
}
