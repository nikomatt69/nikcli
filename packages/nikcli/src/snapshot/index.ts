import fs from "fs/promises"
import path from "path"
import z from "zod"
import { formatPatch, structuredPatch } from "diff"
import { Config } from "../config/config"
import { Git } from "@/git"
import { Global } from "../global"
import { Scheduler } from "../scheduler"
import { Lock } from "@/util/lock"
import { Log } from "../util/log"
import { InstanceState, type InstanceContext, runPromiseWithLayer, withCurrentInstance } from "@/effect"
import { zodObject } from "@/util/effect-zod"
import { Context, Effect, Layer, Schema } from "effect"

export namespace Snapshot {
  const log = Log.create({ service: "snapshot" })
  const hour = 60 * 60 * 1000
  const prune = "7.days"
  const sizeLimit = 2 * 1024 * 1024
  const encoder = new TextEncoder()

  export class SnapshotError extends Schema.TaggedErrorClass<SnapshotError>()("SnapshotError", {
    cause: Schema.Unknown,
  }) {}

  export interface Interface {
    init(): Effect.Effect<void>
    cleanup(): Effect.Effect<void, SnapshotError>
    track(): Effect.Effect<string | undefined, SnapshotError>
    patch(hash: string): Effect.Effect<Patch, SnapshotError>
    restore(snapshot: string): Effect.Effect<void, SnapshotError>
    revert(patches: Patch[]): Effect.Effect<void, SnapshotError>
    diff(hash: string): Effect.Effect<string, SnapshotError>
    diffFull(from: string, to: string): Effect.Effect<FileDiff[], SnapshotError>
  }

  export class Service extends Context.Service<Service, Interface>()("Snapshot.Service") {}

  export const layer = Layer.succeed(
    Service,
    Service.of({
      init: () =>
        Effect.sync(() => {
          Scheduler.register({
            id: "snapshot.cleanup",
            interval: hour,
            run: () =>
              runPromiseWithLayer(
                defaultLayer,
                withCurrentInstance(
                  Effect.gen(function* () {
                    const snapshot = yield* Service
                    yield* snapshot.cleanup()
                  }),
                ),
              ),
            scope: "instance",
            skipInitialRun: true,
          })
        }),
      cleanup: () => InstanceState.context.pipe(Effect.flatMap((ctx) => Effect.tryPromise({ try: () => cleanupImpl(ctx), catch: (e) => new SnapshotError({ cause: e }) }))),
      track: () => InstanceState.context.pipe(Effect.flatMap((ctx) => Effect.tryPromise({ try: () => trackImpl(ctx), catch: (e) => new SnapshotError({ cause: e }) }))),
      patch: (hash) =>
        InstanceState.context.pipe(Effect.flatMap((ctx) => Effect.tryPromise({ try: () => patchImpl(ctx, hash), catch: (e) => new SnapshotError({ cause: e }) }))),
      restore: (snapshot) =>
        InstanceState.context.pipe(Effect.flatMap((ctx) => Effect.tryPromise({ try: () => restoreImpl(ctx, snapshot), catch: (e) => new SnapshotError({ cause: e }) }))),
      revert: (patches) =>
        InstanceState.context.pipe(Effect.flatMap((ctx) => Effect.tryPromise({ try: () => revertImpl(ctx, patches), catch: (e) => new SnapshotError({ cause: e }) }))),
      diff: (hash) => InstanceState.context.pipe(Effect.flatMap((ctx) => Effect.tryPromise({ try: () => diffImpl(ctx, hash), catch: (e) => new SnapshotError({ cause: e }) }))),
      diffFull: (from, to) =>
        InstanceState.context.pipe(Effect.flatMap((ctx) => Effect.tryPromise({ try: () => diffFullImpl(ctx, from, to), catch: (e) => new SnapshotError({ cause: e }) }))),
    }),
  )

  export const defaultLayer = layer

  function gitdir(ctx: InstanceContext) {
    return path.join(Global.Path.data, "snapshot", ctx.project.id)
  }

  function lockKey(ctx: InstanceContext) {
    return `snapshot:${gitdir(ctx)}`
  }

  function configGet() {
    return runPromiseWithLayer(
      Config.defaultLayer,
      withCurrentInstance(
        Effect.gen(function* () {
          const config = yield* Config.Service
          return yield* config.get()
        }),
      ),
    )
  }

  function splitNuls(text: string) {
    return text.split("\0").filter(Boolean)
  }

  function snapshotArgs(ctx: InstanceContext, git: string, args: string[]) {
    return ["--git-dir", git, "--work-tree", ctx.worktree, ...args]
  }

  function nulBuffer(items: string[]) {
    return encoder.encode(items.join("\0") + "\0")
  }

  async function exists(target: string) {
    return fs
      .stat(target)
      .then(() => true)
      .catch(() => false)
  }

  async function withLock<T>(ctx: InstanceContext, fn: () => Promise<T>) {
    using _ = await Lock.write(lockKey(ctx))
    return fn()
  }

  async function sourceGitDir(ctx: InstanceContext) {
    const result = await Git.run(["rev-parse", "--path-format=absolute", "--git-dir"], {
      cwd: ctx.worktree,
    })
    if (result.exitCode !== 0) return undefined
    const value = result.text().trim()
    return value || undefined
  }

  async function ensureInitialized(ctx: InstanceContext, git: string) {
    const initialized = await exists(path.join(git, "HEAD"))
    await fs.mkdir(git, { recursive: true })
    if (initialized) return

    await Git.run(["init"], {
      cwd: ctx.worktree,
      env: {
        GIT_DIR: git,
        GIT_WORK_TREE: ctx.worktree,
      },
    })
    await Git.run(["--git-dir", git, "config", "core.autocrlf", "false"], { cwd: ctx.worktree })
    await Git.run(["--git-dir", git, "config", "core.longpaths", "true"], { cwd: ctx.worktree })
    await Git.run(["--git-dir", git, "config", "core.symlinks", "true"], { cwd: ctx.worktree })
    await Git.run(["--git-dir", git, "config", "core.fsmonitor", "false"], { cwd: ctx.worktree })
    log.info("initialized", { git })
  }

  async function candidateFiles(ctx: InstanceContext, git: string) {
    const [tracked, untracked] = await Promise.all([
      Git.run(snapshotArgs(ctx, git, ["diff-files", "--name-only", "-z", "--", "."]), {
        cwd: ctx.worktree,
      }),
      Git.run(snapshotArgs(ctx, git, ["ls-files", "--others", "--exclude-standard", "-z", "--", "."]), {
        cwd: ctx.worktree,
      }),
    ])

    if (tracked.exitCode !== 0 || untracked.exitCode !== 0) {
      log.warn("failed to list snapshot files", {
        trackedExitCode: tracked.exitCode,
        trackedStderr: tracked.stderr.toString(),
        untrackedExitCode: untracked.exitCode,
        untrackedStderr: untracked.stderr.toString(),
      })
      return {
        tracked: [] as string[],
        untracked: [] as string[],
        all: [] as string[],
      }
    }

    const trackedFiles = splitNuls(tracked.text())
    const untrackedFiles = splitNuls(untracked.text())
    return {
      tracked: trackedFiles,
      untracked: untrackedFiles,
      all: Array.from(new Set([...trackedFiles, ...untrackedFiles])),
    }
  }

  async function ignoredFiles(ctx: InstanceContext, files: string[]) {
    if (files.length === 0) return new Set<string>()
    const source = await sourceGitDir(ctx)
    if (!source) return new Set<string>()

    const result = await Git.run(
      ["--git-dir", source, "--work-tree", ctx.worktree, "check-ignore", "--no-index", "--stdin", "-z"],
      {
        cwd: ctx.worktree,
        stdin: nulBuffer(files),
      },
    )

    if (result.exitCode !== 0 && result.exitCode !== 1) {
      log.warn("failed to evaluate snapshot ignore list", {
        exitCode: result.exitCode,
        stderr: result.stderr.toString(),
      })
      return new Set<string>()
    }

    return new Set(splitNuls(result.text()))
  }

  async function largeFiles(ctx: InstanceContext, files: string[]) {
    const large = new Set<string>()

    await Promise.all(
      files.map(async (file) => {
        const stat = await fs.stat(path.join(ctx.worktree, file)).catch(() => undefined)
        if (stat?.isFile() && stat.size > sizeLimit) {
          large.add(file)
        }
      }),
    )

    return large
  }

  async function dropFromIndex(ctx: InstanceContext, git: string, files: string[]) {
    if (files.length === 0) return

    const result = await Git.run(
      snapshotArgs(ctx, git, [
        "rm",
        "--cached",
        "-f",
        "--ignore-unmatch",
        "--pathspec-from-file=-",
        "--pathspec-file-nul",
      ]),
      {
        cwd: ctx.worktree,
        stdin: nulBuffer(files),
      },
    )

    if (result.exitCode !== 0) {
      log.warn("failed to drop snapshot files from index", {
        exitCode: result.exitCode,
        stderr: result.stderr.toString(),
      })
    }
  }

  async function stageFiles(ctx: InstanceContext, git: string, files: string[]) {
    if (files.length === 0) return

    const result = await Git.run(
      snapshotArgs(ctx, git, ["add", "--all", "--pathspec-from-file=-", "--pathspec-file-nul"]),
      {
        cwd: ctx.worktree,
        stdin: nulBuffer(files),
      },
    )

    if (result.exitCode !== 0) {
      log.warn("failed to add snapshot files", {
        exitCode: result.exitCode,
        stderr: result.stderr.toString(),
      })
    }
  }

  async function stageSnapshot(ctx: InstanceContext, git: string) {
    await ensureInitialized(ctx, git)

    const candidates = await candidateFiles(ctx, git)
    if (candidates.all.length === 0) {
      return {
        excluded: new Set<string>(),
        allowed: [] as string[],
      }
    }

    const ignored = await ignoredFiles(ctx, candidates.all)
    const large = await largeFiles(
      ctx,
      candidates.all.filter((file) => !ignored.has(file)),
    )
    const excluded = new Set([...ignored, ...large])

    if (excluded.size > 0) {
      await dropFromIndex(ctx, git, Array.from(excluded))
    }

    const allowed = candidates.all.filter((file) => !excluded.has(file))
    await stageFiles(ctx, git, allowed)

    return {
      excluded,
      allowed,
    }
  }

  async function showFromSnapshot(ctx: InstanceContext, git: string, hash: string, file: string) {
    const result = await Git.run(snapshotArgs(ctx, git, ["show", `${hash}:${file}`]), {
      cwd: ctx.worktree,
    })

    if (result.exitCode !== 0 || result.stdout.includes(0)) return ""
    return result.text()
  }

  async function revertOne(ctx: InstanceContext, git: string, hash: string, file: string) {
    log.info("reverting", { file, hash })

    const relative = path.relative(ctx.worktree, file).replaceAll("\\", "/")
    const result = await Git.run(snapshotArgs(ctx, git, ["checkout", hash, "--", relative]), {
      cwd: ctx.worktree,
    })

    if (result.exitCode === 0) return

    const tree = await Git.run(snapshotArgs(ctx, git, ["ls-tree", hash, "--", relative]), {
      cwd: ctx.worktree,
    })
    if (tree.exitCode === 0 && tree.text().trim()) {
      log.info("file existed in snapshot but checkout failed, keeping", { file, hash })
      return
    }

    log.info("file did not exist in snapshot, deleting", { file, hash })
    await fs.unlink(file).catch(() => undefined)
  }

  async function cleanupImpl(ctx: InstanceContext) {
    if (ctx.project.vcs !== "git") return
    const cfg = await configGet()
    if (cfg.snapshot === false) return

    await withLock(ctx, async () => {
      const git = gitdir(ctx)
      if (!(await exists(path.join(git, "HEAD")))) return

      const result = await Git.run(snapshotArgs(ctx, git, ["gc", `--prune=${prune}`]), {
        cwd: ctx.worktree,
      })
      if (result.exitCode !== 0) {
        log.warn("cleanup failed", {
          exitCode: result.exitCode,
          stderr: result.stderr.toString(),
          stdout: result.stdout.toString(),
        })
        return
      }

      log.info("cleanup", { prune })
    })
  }

  async function trackImpl(ctx: InstanceContext) {
    if (ctx.project.vcs !== "git") return undefined
    const cfg = await configGet()
    if (cfg.snapshot === false) return undefined

    return withLock(ctx, async () => {
      const git = gitdir(ctx)
      await stageSnapshot(ctx, git)

      const result = await Git.run(snapshotArgs(ctx, git, ["write-tree"]), {
        cwd: ctx.worktree,
      })

      const hash = result.text().trim()
      log.info("tracking", { hash, cwd: ctx.worktree, git })
      return hash || undefined
    })
  }

  const PatchSchema = Schema.Struct({
    hash: Schema.String,
    files: Schema.mutable(Schema.Array(Schema.String)),
  })
  export const Patch = zodObject(PatchSchema)
  export type Patch = Schema.Schema.Type<typeof PatchSchema>

  async function patchImpl(ctx: InstanceContext, hash: string): Promise<Patch> {
    return withLock(ctx, async () => {
      const git = gitdir(ctx)
      const { excluded } = await stageSnapshot(ctx, git)

      const result = await Git.run(
        snapshotArgs(ctx, git, ["diff", "--cached", "--no-ext-diff", "--name-only", "-z", hash, "--", "."]),
        {
          cwd: ctx.worktree,
        },
      )

      if (result.exitCode !== 0) {
        log.warn("failed to get diff", { hash, exitCode: result.exitCode })
        return { hash, files: [] }
      }

      return {
        hash,
        files: splitNuls(result.text())
          .filter((file) => !excluded.has(file))
          .map((file) => path.join(ctx.worktree, file)),
      }
    })
  }

  async function restoreImpl(ctx: InstanceContext, snapshot: string) {
    await withLock(ctx, async () => {
      log.info("restore", { commit: snapshot })
      const git = gitdir(ctx)

      const readTree = await Git.run(snapshotArgs(ctx, git, ["read-tree", snapshot]), {
        cwd: ctx.worktree,
      })
      if (readTree.exitCode !== 0) {
        log.error("failed to restore snapshot", {
          snapshot,
          exitCode: readTree.exitCode,
          stderr: readTree.stderr.toString(),
          stdout: readTree.stdout.toString(),
        })
        return
      }

      const checkout = await Git.run(snapshotArgs(ctx, git, ["checkout-index", "-a", "-f"]), {
        cwd: ctx.worktree,
      })
      if (checkout.exitCode !== 0) {
        log.error("failed to restore snapshot", {
          snapshot,
          exitCode: checkout.exitCode,
          stderr: checkout.stderr.toString(),
          stdout: checkout.stdout.toString(),
        })
      }
    })
  }

  async function revertImpl(ctx: InstanceContext, patches: Patch[]) {
    await withLock(ctx, async () => {
      const git = gitdir(ctx)
      const files = new Map<string, string>()

      for (const item of patches) {
        for (const file of item.files) {
          if (!files.has(file)) files.set(file, item.hash)
        }
      }

      const byHash = new Map<string, string[]>()
      for (const [file, hash] of files) {
        const existing = byHash.get(hash) ?? []
        existing.push(file)
        byHash.set(hash, existing)
      }

      for (const [hash, group] of byHash) {
        const relatives = group.map((file) => path.relative(ctx.worktree, file).replaceAll("\\", "/"))
        const tree = await Git.run(snapshotArgs(ctx, git, ["ls-tree", "--name-only", hash, "--", ...relatives]), {
          cwd: ctx.worktree,
        })

        if (tree.exitCode !== 0) {
          for (const file of group) {
            await revertOne(ctx, git, hash, file)
          }
          continue
        }

        const existing = new Set(
          tree
            .text()
            .split("\n")
            .map((item) => item.trim())
            .filter(Boolean),
        )

        const checkoutFiles = group.filter((file) =>
          existing.has(path.relative(ctx.worktree, file).replaceAll("\\", "/")),
        )
        if (checkoutFiles.length > 0) {
          const checkout = await Git.run(
            snapshotArgs(ctx, git, [
              "checkout",
              hash,
              "--",
              ...checkoutFiles.map((file) => path.relative(ctx.worktree, file).replaceAll("\\", "/")),
            ]),
            {
              cwd: ctx.worktree,
            },
          )

          if (checkout.exitCode !== 0) {
            for (const file of group) {
              await revertOne(ctx, git, hash, file)
            }
            continue
          }
        }

        for (const file of group) {
          const relative = path.relative(ctx.worktree, file).replaceAll("\\", "/")
          if (existing.has(relative)) continue
          log.info("file did not exist in snapshot, deleting", { file, hash })
          await fs.unlink(file).catch(() => undefined)
        }
      }
    })
  }

  async function diffImpl(ctx: InstanceContext, hash: string) {
    return withLock(ctx, async () => {
      const git = gitdir(ctx)
      await stageSnapshot(ctx, git)

      const result = await Git.run(snapshotArgs(ctx, git, ["diff", "--cached", "--no-ext-diff", hash, "--", "."]), {
        cwd: ctx.worktree,
      })

      if (result.exitCode !== 0) {
        log.warn("failed to get diff", {
          hash,
          exitCode: result.exitCode,
          stderr: result.stderr.toString(),
          stdout: result.stdout.toString(),
        })
        return ""
      }

      return result.text().trim()
    })
  }

  export const FileDiff = z
    .object({
      file: z.string(),
      patch: z.string(),
      additions: z.number(),
      deletions: z.number(),
      status: z.enum(["added", "deleted", "modified"]).optional(),
      before: z.string(),
      after: z.string(),
    })
    .meta({
      ref: "FileDiff",
    })
  export type FileDiff = z.infer<typeof FileDiff>

  async function diffFullImpl(ctx: InstanceContext, from: string, to: string): Promise<FileDiff[]> {
    return withLock(ctx, async () => {
      const git = gitdir(ctx)
      const statuses = await Git.run(
        snapshotArgs(ctx, git, ["diff", "--no-ext-diff", "--name-status", "--no-renames", "-z", from, to, "--", "."]),
        {
          cwd: ctx.worktree,
        },
      )
      const stats = await Git.run(
        snapshotArgs(ctx, git, ["diff", "--no-ext-diff", "--no-renames", "--numstat", "-z", from, to, "--", "."]),
        {
          cwd: ctx.worktree,
        },
      )

      if (stats.exitCode !== 0) {
        log.warn("failed to get full diff", {
          from,
          to,
          exitCode: stats.exitCode,
          stderr: stats.stderr.toString(),
          stdout: stats.stdout.toString(),
        })
        return []
      }

      const statusByFile = new Map<string, FileDiff["status"]>()
      const statusItems = splitNuls(statuses.text())
      for (let index = 0; index < statusItems.length; index += 2) {
        const code = statusItems[index]
        const file = statusItems[index + 1]
        if (!code || !file) continue
        statusByFile.set(file, code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified")
      }

      const result: FileDiff[] = []
      for (const item of splitNuls(stats.text())) {
        const firstTab = item.indexOf("\t")
        const secondTab = item.indexOf("\t", firstTab + 1)
        if (firstTab === -1 || secondTab === -1) continue

        const file = item.slice(secondTab + 1)
        if (!file) continue

        const additionsRaw = item.slice(0, firstTab)
        const deletionsRaw = item.slice(firstTab + 1, secondTab)
        const binary = additionsRaw === "-" && deletionsRaw === "-"
        const status = statusByFile.get(file) ?? "modified"
        const additions = binary ? 0 : Number.parseInt(additionsRaw || "0", 10)
        const deletions = binary ? 0 : Number.parseInt(deletionsRaw || "0", 10)

        const before = binary || status === "added" ? "" : await showFromSnapshot(ctx, git, from, file)
        const after = binary || status === "deleted" ? "" : await showFromSnapshot(ctx, git, to, file)
        const patch = binary
          ? ""
          : formatPatch(structuredPatch(file, file, before, after, "", "", { context: Number.MAX_SAFE_INTEGER }))

        result.push({
          file,
          patch,
          additions: Number.isFinite(additions) ? additions : 0,
          deletions: Number.isFinite(deletions) ? deletions : 0,
          status,
          before,
          after,
        })
      }

      return result
    })
  }
}
