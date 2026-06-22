import fs from "fs/promises"
import path from "path"
import { minimatch } from "minimatch"
import { Instance } from "../project/instance"

export namespace FilePathFilters {
  export function normalizeRelative(item: string) {
    return item.replaceAll("\\", "/")
  }

  export function isGitInternal(item: string) {
    const normalized = normalizeRelative(item)
    return normalized === ".git" || normalized.startsWith(".git/")
  }

  export function hidden(item: string): boolean {
    return normalizeRelative(item)
      .split("/")
      .some((part) => part.startsWith(".") && part.length > 1)
  }

  export function depth(item: string): number {
    return normalizeRelative(item).split("/").filter(Boolean).length
  }

  export async function relativePrefix(cwd: string): Promise<string | undefined> {
    let base: string
    try {
      base = await fs.realpath(Instance.directory).catch(() => Instance.directory)
    } catch {
      return undefined
    }
    const target = await fs.realpath(cwd).catch(() => path.resolve(cwd))
    const relative = path.relative(base, target).replaceAll(path.sep, "/")
    if (relative === "") return ""
    if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined
    return relative.endsWith("/") ? relative : `${relative}/`
  }

  export function stripPrefix(relativePath: string, prefix: string) {
    const normalized = normalizeRelative(relativePath)
    if (!prefix) return normalized
    if (!normalized.startsWith(prefix)) return undefined
    return normalized.slice(prefix.length)
  }

  export function matchesGlob(item: string, pattern: string): boolean {
    const normalized = normalizeRelative(item)
    const candidate = normalizeRelative(pattern)
    return minimatch(normalized, candidate, {
      dot: true,
      matchBase: !candidate.includes("/"),
    })
  }

  export function matchesGlobs(item: string, globs: string[] | undefined): boolean {
    if (!globs?.length) return true
    let included = !globs.some((glob) => !glob.startsWith("!"))
    for (const glob of globs) {
      if (!glob) continue
      const excluded = glob.startsWith("!")
      const pattern = excluded ? glob.slice(1) : glob
      if (!pattern || !matchesGlob(item, pattern)) continue
      if (excluded) return false
      included = true
    }
    return included
  }
}
