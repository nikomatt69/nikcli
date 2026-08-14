import semver from "semver"
import { readableStreamToText } from "bun"
import { Log } from "@nikcli-ai/util/log"
import { online } from "@/util/network"

export namespace PackageRegistry {
  const log = Log.create({ service: "bun" })

  function which() {
    return process.execPath
  }

  export async function info(pkg: string, field: string, cwd?: string): Promise<string | null> {
    if (!online()) {
      log.debug("offline, skipping bun info", { pkg, field })
      return null
    }

    const proc = Bun.spawn([which(), "info", pkg, field], {
      windowsHide: true,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        BUN_BE_BUN: "1",
      },
    })

    const code = await proc.exited
    if (code !== 0) {
      const stderr = proc.stderr ? await readableStreamToText(proc.stderr) : ""
      log.warn("bun info failed", { pkg, field, code, stderr })
      return null
    }

    const stdout = proc.stdout ? await readableStreamToText(proc.stdout) : ""
    const value = stdout.trim()
    if (!value) return null
    return value
  }

  export async function isOutdated(pkg: string, cachedVersion: string, cwd?: string): Promise<boolean> {
    const latestVersion = await info(pkg, "version", cwd)
    if (!latestVersion) {
      log.warn("Failed to resolve latest version, using cached", { pkg, cachedVersion })
      return false
    }

    const isRange = /[\s^~*xX<>|=]/.test(cachedVersion)
    if (isRange) return !semver.satisfies(latestVersion, cachedVersion)

    return semver.lt(cachedVersion, latestVersion)
  }
}
