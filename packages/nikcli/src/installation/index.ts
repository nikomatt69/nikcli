import { BusEvent } from "@/bus/bus-event"
import path from "path"
import fs from "fs"
import fsp from "fs/promises"
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
        method: z.enum(["curl", "npm", "yarn", "pnpm", "bun", "brew", "scoop", "choco", "unknown"]).optional(),
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

    // npm/pnpm/bun install the main "nikcli-ai" package, but the
    // platform-specific binary (e.g. "nikcli-ai-windows-x64") is an
    // optional dependency that npm may leave at the old version when
    // the main package is upgraded. Explicitly install/upgrade the
    // platform binary so the new version actually takes effect.
    if (method === "npm" || method === "pnpm" || method === "bun") {
      const platformBinary = platformBinaryPackageName()
      if (platformBinary) {
        log.info("upgrading platform binary", { package: platformBinary, target })
        const binCmd =
          method === "npm"
            ? $`npm install -g ${platformBinary}@${target}`
            : method === "pnpm"
              ? $`pnpm install -g ${platformBinary}@${target}`
              : $`bun install -g ${platformBinary}@${target}`
        const binResult = await binCmd.quiet().throws(false)
        if (binResult.exitCode !== 0) {
          const binStderr = binResult.stderr.toString("utf8")
          // ETARGET = the platform binary version wasn't published to npm.
          // Fall back to the GitHub release binary so the upgrade still works.
          if (binStderr.includes("ETARGET") || binStderr.includes("No matching version")) {
            log.warn("platform binary not on npm, falling back to GitHub release", {
              package: platformBinary,
              target,
            })
            await installPlatformBinaryFromGithub(target)
          } else {
            throw new UpgradeFailedError({ stderr: binStderr })
          }
        }
      }
    }

    await $`${process.execPath} --version`.nothrow().quiet().text()
  }

  function platformBinaryPackageName(): string | undefined {
    const platformMap: Record<string, string> = {
      darwin: "darwin",
      linux: "linux",
      win32: "windows",
    }
    const archMap: Record<string, string> = {
      x64: "x64",
      arm64: "arm64",
      arm: "arm",
    }
    const platform = platformMap[process.platform]
    const arch = archMap[process.arch]
    if (!platform || !arch) return undefined
    return `nikcli-ai-${platform}-${arch}`
  }

  async function installPlatformBinaryFromGithub(target: string) {
    const platformMap: Record<string, string> = {
      darwin: "darwin",
      linux: "linux",
      win32: "windows",
    }
    const archMap: Record<string, string> = {
      x64: "x64",
      arm64: "arm64",
      arm: "arm",
    }
    const platform = platformMap[process.platform] ?? process.platform
    const arch = archMap[process.arch] ?? process.arch
    const binaryName = process.platform === "win32" ? "nikcli.exe" : "nikcli"
    const archiveExt = process.platform === "win32" ? "zip" : "tar.gz"
    const archiveName = `nikcli-ai-${platform}-${arch}.${archiveExt}`
    const downloadUrl = `https://github.com/nikomatt69/nikcli/releases/download/v${target}/${archiveName}`

    log.info("downloading platform binary from GitHub", { url: downloadUrl })

    const tmpDir = path.join(import.meta.dir, "..", ".nikcli-upgrade-tmp")
    const archivePath = path.join(tmpDir, archiveName)
    await fsp.mkdir(tmpDir, { recursive: true }).catch(() => {})

    const response = await fetch(downloadUrl)
    if (!response.ok) {
      throw new UpgradeFailedError({
        stderr: `Failed to download ${archiveName}: ${response.status} ${response.statusText}`,
      })
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    await Bun.write(archivePath, buffer)

    // Extract and find the binary
    const extractDir = path.join(tmpDir, "extract")
    await fsp.mkdir(extractDir, { recursive: true }).catch(() => {})
    if (archiveExt === "zip") {
      const { exitCode } = await $`tar -xf ${archivePath} -C ${extractDir}`.throws(false).quiet()
      if (exitCode !== 0) {
        throw new UpgradeFailedError({ stderr: "Failed to extract zip archive" })
      }
    } else {
      const { exitCode } = await $`tar -xzf ${archivePath} -C ${extractDir}`.throws(false).quiet()
      if (exitCode !== 0) {
        throw new UpgradeFailedError({ stderr: "Failed to extract tar.gz archive" })
      }
    }

    // Find the binary in the extracted directory
    const findBinaryRecursively = (dir: string): string | undefined => {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          const found = findBinaryRecursively(fullPath)
          if (found) return found
        } else if (entry.name === binaryName) {
          return fullPath
        }
      }
      return undefined
    }

    const extractedBinary = findBinaryRecursively(extractDir)
    if (!extractedBinary) {
      throw new UpgradeFailedError({ stderr: `Could not find ${binaryName} in the extracted archive` })
    }

    // Locate the currently installed platform binary package directory
    const pkgName = `nikcli-ai-${platform}-${arch}`
    const npmGlobalDir = path.dirname(path.dirname(process.execPath))
    const installedBinaryDir = path.join(npmGlobalDir, "node_modules", pkgName, "bin")
    const installedBinary = path.join(installedBinaryDir, binaryName)

    if (fs.existsSync(installedBinary)) {
      try {
        fs.unlinkSync(installedBinary)
      } catch {
        // Binary might be in use — can't replace
      }
    }

    // Copy the new binary
    fs.mkdirSync(installedBinaryDir, { recursive: true })
    fs.copyFileSync(extractedBinary, installedBinary)
    if (process.platform !== "win32") {
      fs.chmodSync(installedBinary, 0o755)
    }

    // Clean up
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {})

    log.info("platform binary installed from GitHub", { package: pkgName, target })
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
        return fetch("https://formulae.brew.sh/api/formula/nikcli.json")
          .then((res) => {
            if (!res.ok) throw new Error(res.statusText)
            return res.json()
          })
          .then((data: any) => data.versions.stable)
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
