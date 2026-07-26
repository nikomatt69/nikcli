import { realpathSync } from "fs"

export namespace WindowsPath {
  export function isWindows() {
    return process.platform === "win32"
  }

  export function isUnix() {
    return process.platform === "darwin" || process.platform === "linux"
  }

  export function windowsPath(p: string): string {
    // Only Windows sees git-bash / cygwin / WSL spellings of a drive path. On
    // Linux and macOS `/mnt/c/...` and `/c/...` are ordinary directories, so
    // rewriting them there turns a valid path into a broken one.
    if (!isWindows()) return p

    return p
      .replace(/^\/([a-zA-Z]):(?:[\\/]|$)/, (_, drive) => `${drive.toUpperCase()}:/`)
      .replace(/^\/([a-zA-Z])(?:\/|$)/, (_, drive) => `${drive.toUpperCase()}:/`)
      .replace(/^\/cygdrive\/([a-zA-Z])(?:\/|$)/, (_, drive) => `${drive.toUpperCase()}:/`)
      .replace(/^\/mnt\/([a-zA-Z])(?:\/|$)/, (_, drive) => `${drive.toUpperCase()}:/`)
  }

  export function resolve(p: string): string {
    const normalized = windowsPath(p)
    try {
      return normalizePath(realpathSync.native(normalized))
    } catch {
      return normalizePath(normalized)
    }
  }

  export function normalizePath(p: string): string {
    if (!isWindows()) return p
    try {
      return realpathSync.native(p)
    } catch {
      return p
    }
  }

  export function normalize(p: string): string {
    return normalizePath(resolve(p))
  }

  export function toPosix(p: string): string {
    if (isUnix()) return p
    return p.replace(/\\/g, "/").replace(/^([A-Z]):/, "/$1")
  }

  export function fromGitBash(p: string): string {
    return windowsPath(p)
  }

  export function fromCygwin(p: string): string {
    return windowsPath(p)
  }

  export function fromWSL(p: string): string {
    return windowsPath(p)
  }

  export function isGitBashPath(p: string): boolean {
    return /^\/[a-zA-Z]:/.test(p) && !p.startsWith("/cygdrive/") && !p.startsWith("/mnt/")
  }

  export function isCygwinPath(p: string): boolean {
    return /^\/cygdrive\/[a-zA-Z]/.test(p)
  }

  export function isWSLPath(p: string): boolean {
    return /^\/mnt\/[a-zA-Z]/.test(p)
  }

  export function isWindowsSubsystemPath(p: string): boolean {
    return isGitBashPath(p) || isCygwinPath(p) || isWSLPath(p)
  }

  export function convert(p: string): string {
    if (isWindowsSubsystemPath(p)) {
      return windowsPath(p)
    }
    return p
  }
}
