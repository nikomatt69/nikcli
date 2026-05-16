import { Log } from "../util/log"
import path from "path"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { Lock } from "../util/lock"
import { $ } from "bun"
import { Context, Effect, Layer, Schema } from "effect"

/** In-memory read-through cache with write-through invalidation. */
namespace Cache {
  const store = new Map<string, { value: unknown; expires: number }>()
  const DEFAULT_TTL_MS = 5_000

  export function get<T>(key: string): T | undefined {
    const entry = store.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expires) {
      store.delete(key)
      return undefined
    }
    return entry.value as T
  }

  export function set<T>(key: string, value: T, ttlMs: number = DEFAULT_TTL_MS): void {
    store.set(key, { value, expires: Date.now() + ttlMs })
  }

  export function invalidate(key: string): void {
    store.delete(key)
  }

  export function invalidatePrefix(prefix: string): void {
    for (const key of store.keys()) {
      if (key.startsWith(prefix)) {
        store.delete(key)
      }
    }
  }

  export function clear(): void {
    store.clear()
  }

  export function size(): number {
    return store.size
  }
}

export namespace Storage {
  const log = Log.create({ service: "storage" })

  type Migration = (dir: string) => Promise<void>

  /**
   * Operation types for batch transactions.
   * Each operation is tagged with its type for type-safe dispatch.
   */
  export type WriteOp<T = unknown> = { type: "write"; key: string[]; content: T }
  export type RemoveOp = { type: "remove"; key: string[] }
  export type TransactionOp<T = unknown> = WriteOp<T> | RemoveOp

  export interface Interface {
    remove(key: string[]): Effect.Effect<void, unknown>
    read<T>(key: string[]): Effect.Effect<T, unknown>
    update<T>(key: string[], fn: (draft: T) => void): Effect.Effect<T, unknown>
    write<T>(key: string[], content: T): Effect.Effect<void, unknown>
    list(prefix: string[]): Effect.Effect<string[][], unknown>
    /**
     * Execute multiple operations atomically.
     * All operations succeed or all fail together.
     * Uses a single lock for efficiency and consistency.
     */
    transaction<T extends TransactionOp[]>(ops: T): Effect.Effect<void, unknown>
  }

  export class Service extends Context.Service<Service, Interface>()("Storage.Service") {}

  export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("NotFoundError", {
    message: Schema.String,
  }) {}

  const MIGRATIONS: Migration[] = [
    async (dir) => {
      const project = path.resolve(dir, "../project")
      if (!(await Filesystem.isDir(project))) return
      for await (const projectDir of new Bun.Glob("*").scan({
        cwd: project,
        onlyFiles: false,
      })) {
        log.info(`migrating project ${projectDir}`)
        let projectID = projectDir
        const fullProjectDir = path.join(project, projectDir)
        let worktree = "/"

        if (projectID !== "global") {
          for await (const msgFile of new Bun.Glob("storage/session/message/*/*.json").scan({
            cwd: path.join(project, projectDir),
            absolute: true,
          })) {
            const json = await Bun.file(msgFile).json()
            worktree = json.path?.root
            if (worktree) break
          }
          if (!worktree) continue
          if (!(await Filesystem.isDir(worktree))) continue
          const [id] = await $`git rev-list --max-parents=0 --all`
            .quiet()
            .nothrow()
            .cwd(worktree)
            .text()
            .then((x) =>
              x
                .split("\n")
                .filter(Boolean)
                .map((x) => x.trim())
                .toSorted(),
            )
          if (!id) continue
          projectID = id

          await Bun.write(
            path.join(dir, "project", projectID + ".json"),
            JSON.stringify({
              id,
              vcs: "git",
              worktree,
              time: {
                created: Date.now(),
                initialized: Date.now(),
              },
            }),
          )

          log.info(`migrating sessions for project ${projectID}`)
          for await (const sessionFile of new Bun.Glob("storage/session/info/*.json").scan({
            cwd: fullProjectDir,
            absolute: true,
          })) {
            const dest = path.join(dir, "session", projectID, path.basename(sessionFile))
            log.info("copying", {
              sessionFile,
              dest,
            })
            const session = await Bun.file(sessionFile).json()
            await Bun.write(dest, JSON.stringify(session))
            log.info(`migrating messages for session ${session.id}`)
            for await (const msgFile of new Bun.Glob(`storage/session/message/${session.id}/*.json`).scan({
              cwd: fullProjectDir,
              absolute: true,
            })) {
              const dest = path.join(dir, "message", session.id, path.basename(msgFile))
              log.info("copying", {
                msgFile,
                dest,
              })
              const message = await Bun.file(msgFile).json()
              await Bun.write(dest, JSON.stringify(message))

              log.info(`migrating parts for message ${message.id}`)
              for await (const partFile of new Bun.Glob(`storage/session/part/${session.id}/${message.id}/*.json`).scan(
                {
                  cwd: fullProjectDir,
                  absolute: true,
                },
              )) {
                const dest = path.join(dir, "part", message.id, path.basename(partFile))
                const part = await Bun.file(partFile).json()
                log.info("copying", {
                  partFile,
                  dest,
                })
                await Bun.write(dest, JSON.stringify(part))
              }
            }
          }
        }
      }
    },
    async (dir) => {
      for await (const item of new Bun.Glob("session/*/*.json").scan({
        cwd: dir,
        absolute: true,
      })) {
        const session = await Bun.file(item).json()
        if (!session.projectID) continue
        if (!session.summary?.diffs) continue
        const { diffs } = session.summary
        await Bun.file(path.join(dir, "session_diff", session.id + ".json")).write(JSON.stringify(diffs))
        await Bun.file(path.join(dir, "session", session.projectID, session.id + ".json")).write(
          JSON.stringify({
            ...session,
            summary: {
              additions: diffs.reduce((sum: any, x: any) => sum + x.additions, 0),
              deletions: diffs.reduce((sum: any, x: any) => sum + x.deletions, 0),
            },
          }),
        )
      }
    },
  ]

  const loadState = Effect.promise(async () => {
    const dir = path.join(Global.Path.data, "storage")
    const migration = await Bun.file(path.join(dir, "migration"))
      .json()
      .then((x) => parseInt(x))
      .catch(() => 0)
    for (let index = migration; index < MIGRATIONS.length; index++) {
      log.info("running migration", { index })
      const migration = MIGRATIONS[index]
      try {
        await migration(dir)
        await Bun.write(path.join(dir, "migration"), (index + 1).toString())
      } catch (e) {
        log.error("failed to run migration", { index, error: e })
        break // Don't advance index if migration failed
      }
    }
    return {
      dir,
    }
  })

  async function removeImpl(dir: string, key: string[]) {
    const cacheKey = key.join("/")
    Cache.invalidate(cacheKey)
    const target = path.join(dir, ...key) + ".json"
    return withErrorHandling(async () => {
      try {
        await Bun.file(target).delete()
      } catch (e: any) {
        // Only ignore ENOENT (file doesn't exist) - other errors should propagate
        if (e?.code !== "ENOENT") throw e
      }
    })
  }

  async function readImpl<T>(dir: string, key: string[]) {
    const cacheKey = key.join("/")
    const cached = Cache.get<T>(cacheKey)
    if (cached !== undefined) return cached

    const target = path.join(dir, ...key) + ".json"
    return withErrorHandling(async () => {
      using _ = await Lock.read(target)
      const result = await Bun.file(target).json()
      Cache.set(cacheKey, result as T)
      return result as T
    })
  }

  async function updateImpl<T>(dir: string, key: string[], fn: (draft: T) => void) {
    const target = path.join(dir, ...key) + ".json"
    return withErrorHandling(async () => {
      using _ = await Lock.write(target)
      const content = structuredClone(await Bun.file(target).json())
      fn(content)
      await Bun.write(target, JSON.stringify(content, null, 2))
      Cache.set(key.join("/"), content as T)
      return content as T
    })
  }

  async function writeImpl<T>(dir: string, key: string[], content: T) {
    const target = path.join(dir, ...key) + ".json"
    return withErrorHandling(async () => {
      using _ = await Lock.write(target)
      await Bun.write(target, JSON.stringify(content, null, 2))
      Cache.set(key.join("/"), content)
    })
  }

  async function withErrorHandling<T>(body: () => Promise<T>) {
    return body().catch((e) => {
      if (!(e instanceof Error)) throw e
      const errnoException = e as NodeJS.ErrnoException
      if (errnoException.code === "ENOENT") {
        throw new NotFoundError({ message: `Resource not found: ${errnoException.path}` })
      }
      throw e
    })
  }

  const glob = new Bun.Glob("**/*")
  async function listImpl(dir: string, prefix: string[]) {
    try {
      const result = await Array.fromAsync(
        glob.scan({
          cwd: path.join(dir, ...prefix),
          onlyFiles: true,
        }),
      ).then((results) => results.map((x) => [...prefix, ...x.slice(0, -5).split(path.sep)]))
      result.sort()
      return result
    } catch (error) {
      log.error("list failed", { prefix, error })
      return []
    }
  }

  /**
   * Execute multiple storage operations atomically.
   * All operations succeed or all fail together.
   * Operations are executed in order; locks are acquired in sorted order to prevent deadlocks.
   */
  async function transactionImpl(dir: string, ops: TransactionOp[]) {
    if (ops.length === 0) return

    // Collect all targets and sort for consistent lock ordering (deadlock prevention)
    const targets = ops.map((op) => {
      Cache.invalidate(op.key.join("/"))
      return path.join(dir, ...op.key) + ".json"
    })
    targets.sort()
    const uniqueTargets = [...new Set(targets)]

    // Execute all ops under a single logical lock scope
    await executeWithLocks(uniqueTargets, (dir, ops) => executeTransactionOps(dir, ops), dir, ops)
  }

  async function executeWithLocks<T>(
    targets: string[],
    fn: (dir: string, ops: TransactionOp[]) => Promise<T>,
    dir: string,
    ops: TransactionOp[],
  ): Promise<T> {
    if (targets.length === 0) {
      return fn(dir, ops)
    }

    if (targets.length === 1) {
      using _ = await Lock.write(targets[0])
      return fn(dir, ops)
    }

    if (targets.length === 2) {
      using _ = await Lock.write(targets[0])
      using __ = await Lock.write(targets[1])
      return fn(dir, ops)
    }

    // For 3+ targets, acquire sequentially to avoid complex disposal
    for (const target of targets) {
      using _ = await Lock.write(target)
    }
    return fn(dir, ops)
  }

  async function executeTransactionOps(dir: string, ops: TransactionOp[]) {
    for (const op of ops) {
      if (op.type === "write") {
        const target = path.join(dir, ...op.key) + ".json"
        await Bun.write(target, JSON.stringify(op.content, null, 2))
        Cache.set(op.key.join("/"), op.content)
      } else if (op.type === "remove") {
        const target = path.join(dir, ...op.key) + ".json"
        try {
          await Bun.file(target).delete()
        } catch (e: any) {
          if (e?.code !== "ENOENT") throw e
        }
      }
    }
  }

  const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const cachedState = yield* Effect.cached(loadState)

      return Service.of({
        remove: (key) =>
          Effect.gen(function* () {
            const { dir } = yield* cachedState
            return yield* Effect.tryPromise(() => removeImpl(dir, key))
          }),
        read: <T>(key: string[]) =>
          Effect.gen(function* () {
            const { dir } = yield* cachedState
            return yield* Effect.tryPromise(() => readImpl<T>(dir, key))
          }),
        update: <T>(key: string[], fn: (draft: T) => void) =>
          Effect.gen(function* () {
            const { dir } = yield* cachedState
            return yield* Effect.tryPromise(() => updateImpl<T>(dir, key, fn))
          }),
        write: (key, content) =>
          Effect.gen(function* () {
            const { dir } = yield* cachedState
            return yield* Effect.tryPromise(() => writeImpl(dir, key, content))
          }),
        list: (prefix) =>
          Effect.gen(function* () {
            const { dir } = yield* cachedState
            return yield* Effect.tryPromise(() => listImpl(dir, prefix))
          }),
        transaction: (ops) =>
          Effect.gen(function* () {
            const { dir } = yield* cachedState
            return yield* Effect.tryPromise(() => transactionImpl(dir, ops))
          }),
      })
    }),
  )

  export const defaultLayer = layer
}
