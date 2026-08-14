import { Log } from "@nikcli-ai/util/log"
import { Context } from "../util/context"
import { Project } from "./project"
import { State } from "./state"
import { Filesystem } from "@nikcli-ai/util/filesystem"
import { realpathSync } from "fs"
import path from "path"
import { Effect } from "effect"
import { runService } from "@/effect"

function runProject<A, E>(effect: Effect.Effect<A, E, Project.Service>) {
  return runService(Project, effect)
}

interface Context {
  directory: string
  worktree: string
  project: Project.Info
  disposers: Set<() => void | Promise<void>>
}
const context = Context.create<Context>("instance")
const cache = new Map<string, Promise<Context>>()

/**
 * Whether a directory is the root of its filesystem — `/` on POSIX, `C:\` and
 * friends on Windows. Written against `path.parse` rather than a literal so the
 * two platforms are covered by the same rule.
 */
export function isFilesystemRoot(directory: string) {
  if (!directory) return false
  return directory === "/" || path.parse(directory).root === directory
}

function normalizeDirectory(directory: string) {
  try {
    return realpathSync(directory)
  } catch {
    return path.resolve(directory)
  }
}

export const Instance = {
  async provide<R>(input: { directory: string; init?: () => Promise<any>; fn: () => R }): Promise<R> {
    const directory = normalizeDirectory(input.directory)
    let existing = cache.get(directory)
    if (!existing) {
      Log.Default.info("creating instance", { directory })
      const promise = (async () => {
        const { project, sandbox } = await runProject(
          Effect.gen(function* () {
            const project = yield* Project.Service
            return yield* project.fromDirectory(directory)
          }),
        )
        const ctx = {
          directory,
          worktree: sandbox,
          project,
          disposers: new Set<() => void | Promise<void>>(),
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
  has(directory: string) {
    return cache.has(normalizeDirectory(directory))
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
      const canonicalPath = Filesystem.canonicalizePath(filepath)
      if (Filesystem.contains(canonicalInstance, canonicalPath)) return true
      // A worktree sitting at the filesystem root is the "no repository" fallback
      // (`path.parse(dir).root`), not a containment boundary — treating it as one
      // puts every path on the volume inside the instance, and callers such as the
      // bash tool's external-directory check then never prompt.
      //
      // Only the POSIX spelling `/` used to be recognised, so on Windows the drive
      // root `C:\` fell straight through to the containment test, where
      // `contains("C:\\", anything-on-C)` is true.
      if (isFilesystemRoot(Instance.worktree)) return false
      const canonicalWorktree = realpathSync(Instance.worktree)
      if (isFilesystemRoot(canonicalWorktree)) return false
      return Filesystem.contains(canonicalWorktree, canonicalPath)
    } catch {
      return false
    }
  },
  state<S>(init: () => S, dispose?: (state: Awaited<S>) => Promise<void>): () => S {
    return State.create(() => Instance.directory, init, dispose)
  },
  registerDisposer(disposer: () => void | Promise<void>) {
    context.use().disposers.add(disposer)
  },
  async dispose() {
    const ctx = context.use()
    Log.Default.info("disposing instance", { directory: ctx.directory })

    const { Bus } = await import("@/bus")
    await Bus.publish(Bus.InstanceDisposed, { directory: ctx.directory }).catch((error) => {
      Log.Default.warn("failed to publish instance disposal event", {
        directory: ctx.directory,
        error,
      })
    })

    const tasks = [
      State.dispose(ctx.directory),
      ...Array.from(ctx.disposers, (disposer) =>
        Promise.resolve()
          .then(() => disposer())
          .catch((error) => {
            Log.Default.warn("instance disposer failed", {
              directory: ctx.directory,
              error,
            })
          }),
      ),
    ]

    await Promise.allSettled(tasks)
    ctx.disposers.clear()
    cache.delete(ctx.directory)
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
