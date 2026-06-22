import { realpathSync, statSync } from "fs"
import { mkdir } from "fs/promises"
import { dirname, isAbsolute, join, parse, relative, resolve as pathResolve, sep } from "path"

export namespace Filesystem {
  function isContained(parent: string, child: string) {
    const rel = relative(parent, child)
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
  }

  export function stat(p: string): import("fs").Stats | undefined {
    try {
      return statSync(p)
    } catch {
      return undefined
    }
  }

  export async function readJson<T>(p: string): Promise<T> {
    return Bun.file(p).json() as Promise<T>
  }

  export async function writeJson(p: string, data: unknown): Promise<void> {
    await mkdir(dirname(p), { recursive: true })
    await Bun.write(p, JSON.stringify(data, null, 2))
  }

  export async function readText(p: string): Promise<string> {
    return Bun.file(p).text()
  }

  export async function write(p: string, text: string | Buffer): Promise<void> {
    await mkdir(dirname(p), { recursive: true })
    await Bun.write(p, text)
  }

  export function resolve(p: string): string {
    return pathResolve(p)
  }

  export const exists = (p: string) =>
    Bun.file(p)
      .stat()
      .then(() => true)
      .catch(() => false)

  export const isDir = (p: string) =>
    Bun.file(p)
      .stat()
      .then((s) => s.isDirectory())
      .catch(() => false)
  /**
   * On Windows, normalize a path to its canonical casing using the filesystem.
   * This is needed because Windows paths are case-insensitive but LSP servers
   * may return paths with different casing than what we send them.
   */
  export function normalizePath(p: string): string {
    if (process.platform !== "win32") return p
    try {
      return realpathSync.native(p)
    } catch {
      return p
    }
  }

  export function canonicalizePath(filepath: string) {
    const absolute = isAbsolute(filepath) ? filepath : `${process.cwd()}${sep}${filepath}`
    const { root } = parse(absolute)
    const parts = absolute
      .slice(root.length)
      .split(/[\\/]+/)
      .filter(Boolean)

    let current = root
    for (const part of parts) {
      if (part === ".") continue
      if (part === "..") {
        current = dirname(current)
        continue
      }

      const candidate = join(current, part)
      try {
        current = realpathSync(candidate)
      } catch {
        current = candidate
      }
    }

    return current
  }

  export function overlaps(a: string, b: string) {
    return isContained(a, b) || isContained(b, a)
  }

  export function contains(parent: string, child: string) {
    return isContained(parent, child)
  }

  export function containsCanonical(parent: string, child: string): boolean {
    try {
      const canonicalParent = realpathSync.native(parent)
      const canonicalChild = realpathSync.native(child)
      return isContained(canonicalParent, canonicalChild)
    } catch {
      return contains(parent, child)
    }
  }

  export async function findUp(target: string, start: string, stop?: string) {
    let current = start
    const result = []
    while (true) {
      const search = join(current, target)
      if (await exists(search)) result.push(search)
      if (stop === current) break
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
    return result
  }

  export async function* up(options: { targets: string[]; start: string; stop?: string }) {
    const { targets, start, stop } = options
    let current = start
    while (true) {
      for (const target of targets) {
        const search = join(current, target)
        if (await exists(search)) yield search
      }
      if (stop === current) break
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
  }

  export async function globUp(pattern: string, start: string, stop?: string) {
    let current = start
    const result = []
    while (true) {
      try {
        const glob = new Bun.Glob(pattern)
        for await (const match of glob.scan({
          cwd: current,
          absolute: true,
          onlyFiles: true,
          followSymlinks: true,
          dot: true,
        })) {
          result.push(match)
        }
      } catch {
        // Skip invalid glob patterns
      }
      if (stop === current) break
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
    return result
  }
}
