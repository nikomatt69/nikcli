import path from "path"
import { watch, type FSWatcher } from "fs"
import { fileURLToPath, pathToFileURL } from "url"
import { Filesystem } from "@/util/filesystem"

/**
 * Local plugin sources, as file URLs. Everything else (bare npm specs) resolves
 * into the package cache and is treated as immutable for the session.
 */
export function localSource(spec: string, directory: string) {
  if (spec.startsWith("file://")) return new URL(spec)
  if (spec.startsWith("./") || spec.startsWith("../") || path.isAbsolute(spec) || /^[A-Za-z]:[\\/]/.test(spec)) {
    return pathToFileURL(path.resolve(directory, spec))
  }
  return undefined
}

/**
 * Key local plugin imports by mtime so an edited source re-imports fresh
 * instead of hitting the ESM cache. Bun ignores query params when caching
 * `file://` imports, so bust with a plain path there; Node keys its cache on
 * the full URL.
 */
export function freshSpecifier(entrypoint: string, mtime: number) {
  const raw = entrypoint.startsWith("file://") ? entrypoint : pathToFileURL(entrypoint).href
  if (typeof Bun !== "undefined") return `${fileURLToPath(raw).replaceAll("\\", "/")}?mtime=${mtime}`
  return `${raw}?mtime=${mtime}`
}

/** Entrypoint mtime, or undefined when the file vanished. */
export function entrypointMtime(entrypoint: string) {
  const file = entrypoint.startsWith("file://") ? fileURLToPath(entrypoint) : entrypoint
  const stat = Filesystem.stat(file)
  if (!stat) return
  const value = stat.mtimeMs
  return Math.floor(typeof value === "bigint" ? Number(value) : value)
}

type WatchOptions = {
  onChange: () => void
  debounce?: number
}

/**
 * Watches plugin sources for edits.
 *
 * Files are watched through their parent directory (editors that save by rename
 * replace the inode, which silently kills a direct file watch) and filtered by
 * basename so bursts in busy directories stay quiet. Directory targets are
 * watched at their root only: edits to nested helper files do not change the
 * entrypoint mtime and are not detected. Watches are never torn down
 * individually — a stale watch costs one fs handle and a no-op reconcile — and
 * all die with `dispose()`. Failed watches are forgotten so a later reconcile
 * can re-arm once the path exists again.
 */
export function createSourceWatcher(options: WatchOptions) {
  const delay = options.debounce ?? 100
  const watchers = new Set<FSWatcher>()
  const accepted = new Map<string, Set<string> | null>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  const schedule = () => {
    if (disposed) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (disposed) return
      options.onChange()
    }, delay)
  }

  const arm = (dir: string, name: string | null) => {
    const existing = accepted.get(dir)
    if (existing !== undefined) {
      // A directory target (null) accepts every filename and wins over names.
      if (name === null) accepted.set(dir, null)
      else existing?.add(name)
      return
    }

    accepted.set(dir, name === null ? null : new Set([name]))
    let watcher: FSWatcher
    try {
      watcher = watch(dir, (_event, filename) => {
        // A null filename (platform-dependent) always schedules.
        const accept = accepted.get(dir)
        if (filename && accept && !accept.has(filename.toString())) return
        schedule()
      })
    } catch {
      accepted.delete(dir)
      return
    }

    watcher.on("error", () => {
      watcher.close()
      watchers.delete(watcher)
      accepted.delete(dir)
    })
    watchers.add(watcher)
  }

  return {
    /** Watches one plugin source. Safe to call repeatedly with the same target. */
    add(target: string) {
      if (disposed) return
      const file = target.startsWith("file://") ? fileURLToPath(target) : target
      const stat = Filesystem.stat(file)
      if (!stat) return
      if (stat.isDirectory()) {
        arm(file, null)
        return
      }
      arm(path.dirname(file), path.basename(file))
    },
    /**
     * Watches one file by name through its parent directory, whether or not it
     * exists yet — that is how a config file created after startup is noticed.
     */
    addFile(target: string) {
      if (disposed) return
      const file = target.startsWith("file://") ? fileURLToPath(target) : target
      arm(path.dirname(file), path.basename(file))
    },
    /** Watches every entry of a directory. A missing directory is skipped. */
    addDirectory(target: string) {
      if (disposed) return
      const dir = target.startsWith("file://") ? fileURLToPath(target) : target
      arm(dir, null)
    },
    /**
     * Watches a path however far down it exists: when the target is missing,
     * the nearest existing ancestor is watched for the creation of the next
     * segment. That is what makes a plugin directory created after startup
     * (`.nikcli/plugin/tui`) reach the running TUI.
     */
    addPath(target: string) {
      if (disposed) return
      const full = target.startsWith("file://") ? fileURLToPath(target) : target
      const stat = Filesystem.stat(full)
      if (stat) {
        if (stat.isDirectory()) arm(full, null)
        else arm(path.dirname(full), path.basename(full))
        return
      }

      let current = full
      while (true) {
        const parent = path.dirname(current)
        if (parent === current) return
        if (Filesystem.stat(parent)) {
          arm(parent, path.basename(current))
          return
        }
        current = parent
      }
    },
    dispose() {
      disposed = true
      clearTimeout(timer)
      for (const watcher of watchers) watcher.close()
      watchers.clear()
      accepted.clear()
    },
  }
}

export type SourceWatcher = ReturnType<typeof createSourceWatcher>
