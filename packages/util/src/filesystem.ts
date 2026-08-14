import { realpathSync, lstatSync, statSync } from "fs"
import { mkdir } from "fs/promises"
import { dirname, isAbsolute, join, parse, relative, resolve as pathResolve, sep, win32 } from "path"
import { Schema } from "effect"

export namespace Filesystem {
  function isContained(parent: string, child: string) {
    const rel = relative(parent, child)
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
  }

  export type ContainmentReason = "symlink" | "cross-drive" | "escape"

  /**
   * Tagged error thrown when a path containment check fails. Carries the
   * candidate path, the root it was checked against, and the structured
   * reason so callers can discriminate via `Effect.catchTag`.
   */
  export class ContainmentError extends Schema.TaggedErrorClass<ContainmentError>()("FilesystemContainment", {
    candidate: Schema.String,
    root: Schema.String,
    reason: Schema.Literals(["symlink", "cross-drive", "escape"]),
    message: Schema.String,
  }) {}

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

  export function comparisonKey(p: string, platform = process.platform): string {
    if (platform === "win32") return win32.resolve(p).replaceAll("\\", "/").toLowerCase()
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
    const result = []
    let current = start
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

  /**
   * Confirm that `candidate` resolves to a real path under `root`. Uses
   * realpath to defeat symlink-within-project escapes, walks ancestors for
   * non-existent write targets, and rejects cross-drive paths on Windows.
   *
   * Returns `{ ok: true, real }` on success; `{ ok: false, reason }` on
   * rejection. The caller decides whether to surface `ContainmentError` or
   * an alternative. This is the source of truth for filesystem containment
   * checks; all higher-level wrappers should delegate here.
   *
   * The check is per-segment: at every step a symlink that resolves outside
   * the root is rejected with `reason: "symlink"`, while a `..` walk that
   * escapes the root is rejected with `reason: "escape"`. A path that does
   * not yet exist (e.g. a write target whose parent does exist) is allowed
   * as long as the lexical path is still inside the root, because there is
   * no symlink to follow.
   *
   * The candidate is rewritten so that any lexical prefix matching `root`
   * is replaced with the canonical realpath of `root`. This handles the
   * macOS case where `/var` is a symlink to `/private/var` and the root
   * lives under a temp dir that alias-resolves to `/private/var/folders/...`.
   */
  export async function realpathInside(
    root: string,
    candidate: string,
  ): Promise<{ ok: true; real: string } | { ok: false; reason: ContainmentReason }> {
    let canonicalRoot: string
    try {
      // `.native` like containsCanonical: on Windows the JS realpath resolves
      // symlinks but leaves 8.3 short names alone, so a root spelled
      // `C:\Users\RUNNER~1\...` and a child resolved to `C:\Users\runneradmin\...`
      // would be two spellings of the same directory that no longer compare equal.
      canonicalRoot = realpathSync.native(root)
    } catch {
      return { ok: false, reason: "escape" }
    }

    // Resolve candidate to absolute. If relative, join with the lexical
    // root so the caller's intent is preserved (not process.cwd()).
    const absolute = isAbsolute(candidate) ? candidate : join(root, candidate)

    // Cross-drive detection (Windows): reject `C:\\foo` vs `D:\\bar`.
    if (process.platform === "win32") {
      const rootDrive = parse(canonicalRoot).root
      const candDrive = parse(absolute).root
      if (rootDrive !== candDrive) return { ok: false, reason: "cross-drive" }
    }

    // If the candidate is lexically outside the root, it is an escape
    // attempt — we don't need to walk the path to know. This sidesteps
    // platform quirks (e.g. /var -> /private/var on macOS) where a
    // system symlink would otherwise be mis-reported as the cause.
    const isLexicallyInside = absolute === root || absolute.startsWith(root + sep)
    if (!isLexicallyInside) {
      return { ok: false, reason: "escape" }
    }

    // Walk the relative part starting from canonicalRoot. The walk
    // terminates at the first non-existent segment (write target) or
    // after all segments. Each segment is checked individually: a
    // user-supplied symlink that resolves outside the root is rejected
    // with reason "symlink", a `..` walk that escapes the root is
    // rejected with reason "escape".
    const relPart = absolute === root ? "" : absolute.slice(root.length + sep.length)
    const parts = relPart.split(/[\\/]+/).filter(Boolean)
    let currentReal: string = canonicalRoot
    let rejectedReason: ContainmentReason | undefined

    for (const part of parts) {
      if (part === ".") continue
      if (part === "..") {
        const parent: string = dirname(currentReal)
        if (!isContained(canonicalRoot, parent)) {
          rejectedReason = "escape"
          break
        }
        currentReal = parent
        continue
      }
      const next: string = join(currentReal, part)
      const lstat = lstatSync(next, { throwIfNoEntry: false })
      if (!lstat) {
        // Path doesn't exist (write target); keep lexically and stop.
        currentReal = next
        break
      }
      if (lstat.isSymbolicLink()) {
        try {
          const realTarget: string = realpathSync.native(next)
          if (!isContained(canonicalRoot, realTarget)) {
            rejectedReason = "symlink"
            break
          }
          currentReal = realTarget
        } catch {
          // Broken symlink — hostile, reject.
          rejectedReason = "symlink"
          break
        }
        continue
      }
      // Regular directory or file: probe realpath for canonicalization.
      if (lstat.isDirectory()) {
        try {
          currentReal = realpathSync.native(next)
        } catch {
          currentReal = next
        }
      } else {
        currentReal = next
      }
    }

    if (rejectedReason) return { ok: false, reason: rejectedReason }

    return { ok: true, real: currentReal }
  }
}
