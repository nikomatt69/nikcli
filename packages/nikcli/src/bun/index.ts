import z from "zod"
import { Global } from "../global"
import { Log } from "../util/log"
import path from "path"
import { Filesystem } from "../util/filesystem"
import { NamedError } from "@nikcli-ai/util/error"
import { readableStreamToText } from "bun"
import { createRequire } from "module"
import { Lock } from "../util/lock"
import { proxied } from "../util/network"

export namespace BunProc {
  const log = Log.create({ service: "bun" })
  const req = createRequire(import.meta.url)

  export async function run(cmd: string[], options?: Bun.SpawnOptions.OptionsObject<any, any, any>) {
    log.info("running", {
      cmd: [which(), ...cmd],
      ...options,
    })
    const result = Bun.spawn([which(), ...cmd], {
      ...options,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        ...options?.env,
        BUN_BE_BUN: "1",
      },
    })
    const code = await result.exited
    const stdout = result.stdout
      ? typeof result.stdout === "number"
        ? result.stdout
        : await readableStreamToText(result.stdout)
      : undefined
    const stderr = result.stderr
      ? typeof result.stderr === "number"
        ? result.stderr
        : await readableStreamToText(result.stderr)
      : undefined
    log.info("done", {
      code,
      stdout,
      stderr,
    })
    if (code !== 0) {
      throw new Error(`Command failed with exit code ${result.exitCode}`)
    }
    return result
  }

  export function which() {
    return process.execPath
  }

  export const InstallFailedError = NamedError.create(
    "BunInstallFailedError",
    z.object({
      pkg: z.string(),
      version: z.string(),
    }),
  )

  export async function install(pkg: string, version = "latest") {
    using _ = await Lock.write("bun-install")

    const mod = path.join(Global.Path.cache, "node_modules", pkg)
    const pkgjson = Bun.file(path.join(Global.Path.cache, "package.json"))
    const parsed = await pkgjson.json().catch(async () => {
      const result = { dependencies: {} }
      await Bun.write(pkgjson.name!, JSON.stringify(result, null, 2))
      return result
    })
    const dependencies = parsed.dependencies ?? {}
    if (!parsed.dependencies) parsed.dependencies = dependencies
    const modExists = await Filesystem.exists(mod)
    if (dependencies[pkg] === version && modExists) return mod

    const args = [
      "add",
      "--force",
      "--exact",
      ...(proxied() ? ["--no-cache"] : []),
      "--cwd",
      Global.Path.cache,
      pkg + "@" + version,
    ]

    log.info("installing package using Bun's default registry resolution", {
      pkg,
      version,
    })

    await BunProc.run(args, {
      cwd: Global.Path.cache,
    }).catch((e) => {
      throw new InstallFailedError(
        { pkg, version },
        {
          cause: e,
        },
      )
    })

    let resolvedVersion = version
    if (version === "latest") {
      const installedPkgJson = Bun.file(path.join(mod, "package.json"))
      const installedPkg = await installedPkgJson.json().catch(() => null)
      if (installedPkg?.version) {
        resolvedVersion = installedPkg.version
      }
    }

    parsed.dependencies[pkg] = resolvedVersion
    await Bun.write(pkgjson.name!, JSON.stringify(parsed, null, 2))
    return mod
  }

  const illegalWin32Chars = process.platform === "win32" ? new Set(["<", ">", ":", '"', "|", "?", "*"]) : undefined

  export function sanitize(pkg: string): string {
    if (!illegalWin32Chars) return pkg
    return Array.from(pkg, (char) =>
      illegalWin32Chars.has(char) || char.charCodeAt(0) < 32 ? "_" : char,
    ).join("")
  }

  export interface EntryPoint {
    directory: string
    entrypoint: string | undefined
  }

  export function resolveEntryPoint(name: string, dir: string): EntryPoint {
    const directory = path.join(dir, "node_modules", ...name.split("/"))
    let entrypoint: string | undefined
    try {
      const resolved = req.resolve(name, { paths: [dir] })
      if (typeof resolved === "string") entrypoint = resolved
    } catch {
      // Fallback: read package.json
      try {
        const pkgPath = path.join(directory, "package.json")
        const raw = req(pkgPath)
        if (typeof raw?.main === "string") entrypoint = path.join(directory, raw.main)
        else if (raw?.exports?.["."]?.import) entrypoint = path.join(directory, raw.exports["."].import)
        else if (raw?.exports?.["."]?.require) entrypoint = path.join(directory, raw.exports["."].require)
      } catch {
        // leave undefined
      }
    }
    return { directory, entrypoint }
  }

  export async function add(pkg: string, version: string = "latest"): Promise<EntryPoint & { version: string }> {
    const directory = await install(pkg, version)
    let resolvedVersion = version
    if (version === "latest") {
      try {
        const installedPkg = await Bun.file(path.join(directory, "package.json")).json()
        if (installedPkg?.version) resolvedVersion = installedPkg.version
      } catch {
        // keep "latest"
      }
    }
    const entry = resolveEntryPoint(pkg, Global.Path.cache)
    return { directory: entry.directory, entrypoint: entry.entrypoint, version: resolvedVersion }
  }

  export async function outdated(pkg: string, cachedVersion: string, cwd?: string): Promise<boolean> {
    const { PackageRegistry } = await import("./registry")
    return PackageRegistry.isOutdated(pkg, cachedVersion, cwd)
  }

  export function pathFor(pkg: string, dir: string = Global.Path.cache): EntryPoint {
    return resolveEntryPoint(pkg, dir)
  }
}

// Opencode-style Npm/Pkg namespace barrel — maps directly onto BunProc so consumers
// that expect the opencode `Npm.*` surface find an equivalent Bun-backed API.
export namespace Pkg {
  export const add = BunProc.add
  export const install = BunProc.install
  export const outdated = BunProc.outdated
  export const which = BunProc.pathFor
  export const sanitize = BunProc.sanitize
  export const InstallFailedError = BunProc.InstallFailedError
  export type EntryPoint = BunProc.EntryPoint
}
