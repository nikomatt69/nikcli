import { Log } from "@/util/log"
import { Context } from "../util/context"
import { Project } from "./project"
import { State } from "./state"
import { GlobalBus } from "@/bus/global"
import { Filesystem } from "@/util/filesystem"
import { realpathSync } from "fs"
import path from "path"

interface Context {
  directory: string
  worktree: string
  project: Project.Info
}
const context = Context.create<Context>("instance")
const cache = new Map<string, Promise<Context>>()

function normalizeDirectory(directory: string) {
  try {
    return realpathSync(directory)
  } catch {
    return path.resolve(directory)
  }
}

function canonicalizePath(filepath: string) {
  const absolute = path.isAbsolute(filepath) ? filepath : `${process.cwd()}${path.sep}${filepath}`
  const { root } = path.parse(absolute)
  const parts = absolute
    .slice(root.length)
    .split(/[\\/]+/)
    .filter(Boolean)

  let current = root
  for (const part of parts) {
    if (part === ".") continue
    if (part === "..") {
      current = path.dirname(current)
      continue
    }

    const candidate = path.join(current, part)
    try {
      current = realpathSync(candidate)
    } catch {
      current = candidate
    }
  }

  return current
}

export const Instance = {
  async provide<R>(input: { directory: string; init?: () => Promise<any>; fn: () => R }): Promise<R> {
    const directory = normalizeDirectory(input.directory)
    let existing = cache.get(directory)
    if (!existing) {
      Log.Default.info("creating instance", { directory })
      const promise = (async () => {
        const { project, sandbox } = await Project.fromDirectory(directory)
        const ctx = {
          directory,
          worktree: sandbox,
          project,
        }
        await context.provide(ctx, async () => {
          await input.init?.()
        })
        return ctx
      })()
      cache.set(directory, promise)
      existing = promise
    }

    let ctx: Context
    try {
      ctx = await existing
    } catch (err) {
      if (cache.get(directory) === existing) {
        cache.delete(directory)
      }
      Log.Default.warn("instance creation failed", { directory, error: err })
      throw err
    }

    return context.provide(ctx, async () => {
      return input.fn()
    })
  },
  get directory() {
    return context.use().directory
  },
  get worktree() {
    return context.use().worktree
  },
  get project() {
    return context.use().project
  },
  containsPath(filepath: string) {
    try {
      const canonicalInstance = realpathSync(Instance.directory)
      const canonicalWorktree = Instance.worktree === "/" ? "/" : realpathSync(Instance.worktree)
      const canonicalPath = canonicalizePath(filepath)
      if (Filesystem.contains(canonicalInstance, canonicalPath)) return true
      if (canonicalWorktree === "/") return false
      return Filesystem.contains(canonicalWorktree, canonicalPath)
    } catch {
      return false
    }
  },
  state<S>(init: () => S, dispose?: (state: Awaited<S>) => Promise<void>): () => S {
    return State.create(() => Instance.directory, init, dispose)
  },
  async dispose() {
    Log.Default.info("disposing instance", { directory: Instance.directory })
    await State.dispose(Instance.directory)
    cache.delete(Instance.directory)
    GlobalBus.emit("event", {
      directory: Instance.directory,
      payload: {
        type: "server.instance.disposed",
        properties: {
          directory: Instance.directory,
        },
      },
    })
  },
  async disposeAll() {
    Log.Default.info("disposing all instances")
    for (const [_key, value] of cache) {
      const awaited = await value.catch(() => {})
      if (awaited) {
        await context.provide(await value, async () => {
          await Instance.dispose()
        })
      }
    }
    cache.clear()
  },
}
