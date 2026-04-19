import fs from "fs/promises"
import path from "path"
import z from "zod"
import { formatPatch, structuredPatch } from "diff"
import { Config } from "../config/config"
import { Git } from "@/git"
import { Global } from "../global"
import { Instance } from "../project/instance"
import { Scheduler } from "../scheduler"
import { Lock } from "@/util/lock"
import { Log } from "../util/log"

export namespace Snapshot {
  const log = Log.create({ service: "snapshot" })
  const hour = 60 * 60 * 1000
  const prune = "7.days"
  const sizeLimit = 2 * 1024 * 1024
  const encoder = new TextEncoder()

  export function init() {
    Scheduler.register({
      id: "snapshot.cleanup",
      interval: hour,
      run: cleanup,
      scope: "instance",
    })
  }

  function gitdir() {
    return path.join(Global.Path.data, "snapshot", Instance.project.id)
  }

  function lockKey() {
    return `snapshot:${gitdir()}`
  }

  function splitNuls(text: string) {
    return text.split("\0").filter(Boolean)
  }

  function snapshotArgs(git: string, args: string[]) {
    return ["--git-dir", git, "--work-tree", Instance.worktree, ...args]
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

  async function withLock<T>(fn: () => Promise<T>) {
    using _ = await Lock.write(lockKey())
    return fn()
  }

  async function sourceGitDir() {
    const result = await Git.run(["rev-parse", "--path-format=absolute", "--git-dir"], {
      cwd: Instance.worktree,
    })
    if (result.exitCode !== 0) return undefined
    const value = result.text().trim()
    return value || undefined
  }

  async function ensureInitialized(git: string) {
    const initialized = await exists(path.join(git, "HEAD"))
    await fs.mkdir(git, { recursive: true })
    if (initialized) return

    await Git.run(["init"], {
      cwd: Instance.worktree,
      env: {
        GIT_DIR: git,
        GIT_WORK_TREE: Instance.worktree,
      },
    })
    await Git.run(["--git-dir", git, "config", "core.autocrlf", "false"], { cwd: Instance.worktree })
    await Git.run(["--git-dir", git, "config", "core.longpaths", "true"], { cwd: Instance.worktree })
    await Git.run(["--git-dir", git, "config", "core.symlinks", "true"], { cwd: Instance.worktree })
    await Git.run(["--git-dir", git, "config", "core.fsmonitor", "false"], { cwd: Instance.worktree })
    log.info("initialized", { git })
  }

  async function candidateFiles(git: string) {
    const [tracked, untracked] = await Promise.all([
      Git.run(snapshotArgs(git, ["diff-files", "--name-only", "-z", "--", "."]), {
        cwd: Instance.worktree,
      }),
      Git.run(snapshotArgs(git, ["ls-files", "--others", "--exclude-standard", "-z", "--", "."]), {
        cwd: Instance.worktree,
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

  async function ignoredFiles(files: string[]) {
    if (files.length === 0) return new Set<string>()
    const source = await sourceGitDir()
    if (!source) return new Set<string>()

    const result = await Git.run(
      ["--git-dir", source, "--work-tree", Instance.worktree, "check-ignore", "--no-index", "--stdin", "-z"],
      {
        cwd: Instance.worktree,
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

  async function largeFiles(files: string[]) {
    const large = new Set<string>()

    await Promise.all(
      files.map(async (file) => {
        const stat = await fs.stat(path.join(Instance.worktree, file)).catch(() => undefined)
        if (stat?.isFile() && stat.size > sizeLimit) {
          large.add(file)
        }
      }),
    )

    return large
  }

  async function dropFromIndex(git: string, files: string[]) {
    if (files.length === 0) return

    const result = await Git.run(
      snapshotArgs(git, ["rm", "--cached", "-f", "--ignore-unmatch", "--pathspec-from-file=-", "--pathspec-file-nul"]),
      {
        cwd: Instance.worktree,
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

  async function stageFiles(git: string, files: string[]) {
    if (files.length === 0) return

    const result = await Git.run(snapshotArgs(git, ["add", "--all", "--pathspec-from-file=-", "--pathspec-file-nul"]), {
      cwd: Instance.worktree,
      stdin: nulBuffer(files),
    })

    if (result.exitCode !== 0) {
      log.warn("failed to add snapshot files", {
        exitCode: result.exitCode,
        stderr: result.stderr.toString(),
      })
    }
  }

  async function stageSnapshot(git: string) {
    await ensureInitialized(git)

    const candidates = await candidateFiles(git)
    if (candidates.all.length === 0) {
      return {
        excluded: new Set<string>(),
        allowed: [] as string[],
      }
    }

    const ignored = await ignoredFiles(candidates.all)
    const large = await largeFiles(candidates.all.filter((file) => !ignored.has(file)))
    const excluded = new Set([...ignored, ...large])

    if (excluded.size > 0) {
      await dropFromIndex(git, Array.from(excluded))
    }

    const allowed = candidates.all.filter((file) => !excluded.has(file))
    await stageFiles(git, allowed)

    return {
      excluded,
      allowed,
    }
  }

  async function showFromSnapshot(git: string, hash: string, file: string) {
    const result = await Git.run(snapshotArgs(git, ["show", `${hash}:${file}`]), {
      cwd: Instance.worktree,
    })

    if (result.exitCode !== 0 || result.stdout.includes(0)) return ""
    return result.text()
  }

  async function revertOne(git: string, hash: string, file: string) {
    log.info("reverting", { file, hash })

    const relative = path.relative(Instance.worktree, file).replaceAll("\\", "/")
    const result = await Git.run(snapshotArgs(git, ["checkout", hash, "--", relative]), {
      cwd: Instance.worktree,
    })

    if (result.exitCode === 0) return

    const tree = await Git.run(snapshotArgs(git, ["ls-tree", hash, "--", relative]), {
      cwd: Instance.worktree,
    })
    if (tree.exitCode === 0 && tree.text().trim()) {
      log.info("file existed in snapshot but checkout failed, keeping", { file, hash })
      return
    }

    log.info("file did not exist in snapshot, deleting", { file, hash })
    await fs.unlink(file).catch(() => undefined)
  }

  export async function cleanup() {
    if (Instance.project.vcs !== "git") return
    const cfg = await Config.get()
    if (cfg.snapshot === false) return

    await withLock(async () => {
      const git = gitdir()
      if (!(await exists(path.join(git, "HEAD")))) return

      const result = await Git.run(snapshotArgs(git, ["gc", `--prune=${prune}`]), {
        cwd: Instance.worktree,
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

  export async function track() {
    if (Instance.project.vcs !== "git") return undefined
    const cfg = await Config.get()
    if (cfg.snapshot === false) return undefined

    return withLock(async () => {
      const git = gitdir()
      await stageSnapshot(git)

      const result = await Git.run(snapshotArgs(git, ["write-tree"]), {
        cwd: Instance.worktree,
      })

      const hash = result.text().trim()
      log.info("tracking", { hash, cwd: Instance.worktree, git })
      return hash || undefined
    })
  }

  export const Patch = z.object({
    hash: z.string(),
    files: z.string().array(),
  })
  export type Patch = z.infer<typeof Patch>

  export async function patch(hash: string): Promise<Patch> {
    return withLock(async () => {
      const git = gitdir()
      const { excluded } = await stageSnapshot(git)

      const result = await Git.run(
        snapshotArgs(git, ["diff", "--cached", "--no-ext-diff", "--name-only", "-z", hash, "--", "."]),
        {
          cwd: Instance.worktree,
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
          .map((file) => path.join(Instance.worktree, file)),
      }
    })
  }

  export async function restore(snapshot: string) {
    await withLock(async () => {
      log.info("restore", { commit: snapshot })
      const git = gitdir()

      const readTree = await Git.run(snapshotArgs(git, ["read-tree", snapshot]), {
        cwd: Instance.worktree,
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

      const checkout = await Git.run(snapshotArgs(git, ["checkout-index", "-a", "-f"]), {
        cwd: Instance.worktree,
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

  export async function revert(patches: Patch[]) {
    await withLock(async () => {
      const git = gitdir()
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
        const relatives = group.map((file) => path.relative(Instance.worktree, file).replaceAll("\\", "/"))
        const tree = await Git.run(snapshotArgs(git, ["ls-tree", "--name-only", hash, "--", ...relatives]), {
          cwd: Instance.worktree,
        })

        if (tree.exitCode !== 0) {
          for (const file of group) {
            await revertOne(git, hash, file)
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
          existing.has(path.relative(Instance.worktree, file).replaceAll("\\", "/")),
        )
        if (checkoutFiles.length > 0) {
          const checkout = await Git.run(
            snapshotArgs(git, [
              "checkout",
              hash,
              "--",
              ...checkoutFiles.map((file) => path.relative(Instance.worktree, file).replaceAll("\\", "/")),
            ]),
            {
              cwd: Instance.worktree,
            },
          )

          if (checkout.exitCode !== 0) {
            for (const file of group) {
              await revertOne(git, hash, file)
            }
            continue
          }
        }

        for (const file of group) {
          const relative = path.relative(Instance.worktree, file).replaceAll("\\", "/")
          if (existing.has(relative)) continue
          log.info("file did not exist in snapshot, deleting", { file, hash })
          await fs.unlink(file).catch(() => undefined)
        }
      }
    })
  }

  export async function diff(hash: string) {
    return withLock(async () => {
      const git = gitdir()
      await stageSnapshot(git)

      const result = await Git.run(snapshotArgs(git, ["diff", "--cached", "--no-ext-diff", hash, "--", "."]), {
        cwd: Instance.worktree,
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

  export async function diffFull(from: string, to: string): Promise<FileDiff[]> {
    return withLock(async () => {
      const git = gitdir()
      const statuses = await Git.run(
        snapshotArgs(git, ["diff", "--no-ext-diff", "--name-status", "--no-renames", "-z", from, to, "--", "."]),
        {
          cwd: Instance.worktree,
        },
      )
      const stats = await Git.run(
        snapshotArgs(git, ["diff", "--no-ext-diff", "--no-renames", "--numstat", "-z", from, to, "--", "."]),
        {
          cwd: Instance.worktree,
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

        const before = binary || status === "added" ? "" : await showFromSnapshot(git, from, file)
        const after = binary || status === "deleted" ? "" : await showFromSnapshot(git, to, file)
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
