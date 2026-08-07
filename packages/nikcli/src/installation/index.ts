import { BusEvent } from "@/bus/bus-event"
import path from "path"
import { $ } from "bun"
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
    Updated: BusEvent.schema(
      "installation.updated",
      Schema.Struct({
        version: Schema.String,
      }),
    ),
    UpdateAvailable: BusEvent.schema(
      "installation.update-available",
      Schema.Struct({
        version: Schema.String,
        method: Schema.optional(
          Schema.Literals(["curl", "npm", "yarn", "pnpm", "bun", "brew", "scoop", "choco", "unknown"]),
        ),
        current: Schema.optional(Schema.String),
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
      upgrade: (method, target) =>
        Effect.tryPromise({
          try: () => upgradeImpl(method, target),
          catch: (error) => error,
        }),
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

  export const WINDOWS_UPGRADE_SCRIPT = "irm https://nikcli.store/install.ps1 | iex"

  export type UpgradeStrategy =
    | { type: "windows-installer"; script: typeof WINDOWS_UPGRADE_SCRIPT }
    | { type: "package-manager"; method: Method }

  export function resolveUpgradeStrategy(
    method: Method,
    platform: NodeJS.Platform = process.platform,
  ): UpgradeStrategy {
    // On Windows only standalone installs (the "curl" method, i.e. the binary
    // in ~/.nikcli/bin) and unknown installs go through the PowerShell
    // installer. Package-manager installs must upgrade through their own
    // manager: the manager's shim/binary (e.g. %AppData%\npm, choco or scoop
    // bins) shadows ~/.nikcli\bin on PATH, so a standalone installer run would
    // "succeed" while the command the user actually runs stays on the old
    // version.
    if (platform === "win32" && (method === "curl" || method === "unknown")) {
      return { type: "windows-installer", script: WINDOWS_UPGRADE_SCRIPT }
    }
    return { type: "package-manager", method }
  }

  async function getBrewFormula() {
    const tapFormula = await $`brew list --formula nikomatt69/tap/nikcli`.throws(false).quiet().text()
    if (tapFormula.includes("nikcli")) return "nikomatt69/tap/nikcli"
    const coreFormula = await $`brew list --formula nikcli`.throws(false).quiet().text()
    if (coreFormula.includes("nikcli")) return "nikcli"
    return "nikcli"
  }

  async function upgradeImpl(method: Method, target: string) {
    let cmd
    const strategy = resolveUpgradeStrategy(method)
    if (strategy.type === "windows-installer") {
      cmd = $`powershell -NoProfile -NonInteractive -Command ${strategy.script}`.env({
        ...process.env,
        NIKCLI_VERSION: target,
        NIKCLI_UPGRADE_PID: process.pid.toString(),
      })
    } else
      switch (strategy.method) {
        case "curl":
        case "unknown":
          // "unknown" means the install method could not be detected and the
          // user chose "install anyways" — fall back to the standalone
          // installer.
          cmd = $`curl -fsSL https://nikcli.store/install | bash`.env({
            ...process.env,
            VERSION: target,
          })
          break
        case "npm":
          cmd = $`npm install -g nikcli-ai@${target}`
          break
        case "yarn":
          cmd = $`yarn global add nikcli-ai@${target}`
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
      // The PowerShell installer reports failures via Write-Host (stdout), not
      // stderr, so prefer whichever stream actually carries the message.
      const stderr =
        result.stderr.toString("utf8").trim() ||
        result.stdout.toString("utf8").trim() ||
        `Upgrade command exited with code ${result.exitCode}`
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

    // Best-effort verification that the upgrade actually took effect. Skipped
    // on Windows: the running binary is locked there and the installer already
    // validated the version before replacing the file (or deferring the swap).
    if (process.platform !== "win32") {
      const probe = (
        await $`nikcli --version`
          .nothrow()
          .quiet()
          .text()
          .catch(() => "")
      ).trim()
      const installed = probe.replace(/^v/, "")
      const expected = target.replace(/^v/, "")
      // Only fail on a clean, different semver: an unparseable probe (e.g.
      // nikcli not on PATH in this environment) means we cannot verify, so we
      // trust the installer's exit code instead of blocking a real upgrade.
      if (/^\d+\.\d+\.\d+/.test(installed) && installed !== expected) {
        throw new UpgradeFailedError({
          stderr: `Upgrade did not take effect: nikcli reports ${installed}, expected ${expected}.`,
        })
      }
    }
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
        // The core formula does not exist on formulae.brew.sh today; if it is
        // ever added we use it, otherwise fall through to the GitHub release.
        const res = await fetch("https://formulae.brew.sh/api/formula/nikcli.json").catch(() => null)
        if (res?.ok) {
          const data = (await res.json()) as { versions?: { stable?: string } }
          if (data.versions?.stable) return data.versions.stable
        }
      }
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
      // The Chocolatey OData API rejects JSON Accept headers; it only serves
      // Atom/XML. Parse the <d:Version> element out of the feed.
      return fetch(
        "https://community.chocolatey.org/api/v2/Packages?$filter=Id%20eq%20%27nikcli%27%20and%20IsLatestVersion&$select=Version",
        { headers: { Accept: "application/atom+xml" } },
      )
        .then((res) => {
          if (!res.ok) throw new Error(res.statusText)
          return res.text()
        })
        .then((xml) => {
          const match = /<d:Version>([^<]+)<\/d:Version>/.exec(xml)
          if (!match) throw new Error("nikcli package not found on Chocolatey")
          return match[1]
        })
    }

    if (detectedMethod === "scoop") {
      return fetch("https://raw.githubusercontent.com/ScoopInstaller/Main/master/bucket/nikcli.json", {
        headers: { Accept: "application/json" },
      })
        .then((res) => {
          if (!res.ok) throw new Error("nikcli is not published to Scoop's Main bucket")
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
