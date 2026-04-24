import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import z from "zod"
import { NamedError } from "@nikcli-ai/util/error"
import { Global } from "../global"
import { Instance } from "../project/instance"
import { fn } from "../util/fn"
import { Git } from "@/git"
import { Log } from "@/util/log"

export namespace Worktree {
  export const Info = z
    .object({
      name: z.string(),
      branch: z.string(),
      directory: z.string(),
    })
    .meta({
      ref: "Worktree",
    })

  export type Info = z.infer<typeof Info>

  export const CreateInput = z
    .object({
      name: z.string().optional(),
      branch: z.string().optional(),
      branchPrefix: z.string().optional(),
      baseBranch: z.string().optional(),
      remote: z.string().optional(),
      startCommand: z.string().optional(),
    })
    .meta({
      ref: "WorktreeCreateInput",
    })

  export type CreateInput = z.infer<typeof CreateInput>

  export const RemoveInput = z
    .object({
      directory: z.string(),
    })
    .meta({
      ref: "WorktreeRemoveInput",
    })

  export type RemoveInput = z.infer<typeof RemoveInput>

  export const ResetInput = z
    .object({
      directory: z.string(),
    })
    .meta({
      ref: "WorktreeResetInput",
    })

  export type ResetInput = z.infer<typeof ResetInput>

  export const NotGitError = NamedError.create(
    "WorktreeNotGitError",
    z.object({
      message: z.string(),
    }),
  )

  export const NameGenerationFailedError = NamedError.create(
    "WorktreeNameGenerationFailedError",
    z.object({
      message: z.string(),
    }),
  )

  export const CreateFailedError = NamedError.create(
    "WorktreeCreateFailedError",
    z.object({
      message: z.string(),
    }),
  )

  export const StartCommandFailedError = NamedError.create(
    "WorktreeStartCommandFailedError",
    z.object({
      message: z.string(),
    }),
  )

  export const RemoveFailedError = NamedError.create(
    "WorktreeRemoveFailedError",
    z.object({
      message: z.string(),
    }),
  )

  export const ResetFailedError = NamedError.create(
    "WorktreeResetFailedError",
    z.object({
      message: z.string(),
    }),
  )

  const ADJECTIVES = [
    "brave",
    "calm",
    "clever",
    "cosmic",
    "crisp",
    "curious",
    "eager",
    "gentle",
    "glowing",
    "happy",
    "hidden",
    "jolly",
    "kind",
    "lucky",
    "mighty",
    "misty",
    "neon",
    "nimble",
    "playful",
    "proud",
    "quick",
    "quiet",
    "shiny",
    "silent",
    "stellar",
    "sunny",
    "swift",
    "tidy",
    "witty",
  ] as const

  const NOUNS = [
    "cabin",
    "cactus",
    "canyon",
    "circuit",
    "comet",
    "eagle",
    "engine",
    "falcon",
    "forest",
    "garden",
    "harbor",
    "island",
    "knight",
    "lagoon",
    "meadow",
    "moon",
    "mountain",
    "nebula",
    "orchid",
    "otter",
    "panda",
    "pixel",
    "planet",
    "river",
    "rocket",
    "sailor",
    "squid",
    "star",
    "tiger",
    "wizard",
    "wolf",
  ] as const

  function pick<const T extends readonly string[]>(list: T) {
    return list[Math.floor(Math.random() * list.length)]
  }

  function slug(input: string) {
    return input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+/, "")
      .replace(/-+$/, "")
  }

  function randomName() {
    return `${pick(ADJECTIVES)}-${pick(NOUNS)}`
  }

  function branchName(input: string) {
    return input
      .split("/")
      .map((part) => slug(part))
      .filter(Boolean)
      .join("/")
  }

  async function exists(target: string) {
    return fs
      .stat(target)
      .then(() => true)
      .catch(() => false)
  }

  function outputText(input: Uint8Array | undefined) {
    if (!input?.length) return ""
    return new TextDecoder().decode(input).trim()
  }

  function errorText(result: { stdout?: Uint8Array; stderr?: Uint8Array }) {
    return [outputText(result.stderr), outputText(result.stdout)].filter(Boolean).join("\n")
  }

  const log = Log.create({ service: "worktree" })

  export type WorktreeEntry = { path?: string; branch?: string }

  async function listWorktrees(cwd?: string): Promise<WorktreeEntry[]> {
    const worktreeCwd = cwd ?? Instance.worktree
    const list = await Git.run(["worktree", "list", "--porcelain"], { cwd: worktreeCwd })
    if (list.exitCode !== 0) {
      throw new RemoveFailedError({ message: list.text().trim() || "Failed to read git worktrees" })
    }

    const lines = list
      .text()
      .split("\n")
      .map((line) => line.trim())
    return lines.reduce<WorktreeEntry[]>((acc, line) => {
      if (!line) return acc
      if (line.startsWith("worktree ")) {
        acc.push({ path: line.slice("worktree ".length).trim() })
        return acc
      }
      const current = acc[acc.length - 1]
      if (!current) return acc
      if (line.startsWith("branch ")) {
        current.branch = line.slice("branch ".length).trim()
      }
      return acc
    }, [])
  }

  /**
   * Parse git worktree list --porcelain output into Worktree.Info objects.
   * Used internally and exposed via Worktree.list().
   */
  async function parseWorktrees(cwd?: string): Promise<Info[]> {
    const entries = await listWorktrees(cwd)
    return entries
      .filter((e) => e.path)
      .map((entry) => {
        const name = path.basename(entry.path!)
        const branch = entry.branch?.replace(/^refs\/heads\//, "") ?? ""
        return Info.parse({ name, branch, directory: entry.path })
      })
  }

  async function findWorktreeEntry(directory: string, cwd?: string): Promise<WorktreeEntry | undefined> {
    const entries = await listWorktrees(cwd)
    return entries.find((item) => item.path && path.resolve(item.path) === path.resolve(directory))
  }

  async function remotes() {
    const remoteList = await Git.run(["remote"], { cwd: Instance.worktree })
    if (remoteList.exitCode !== 0) return [] as string[]
    return remoteList
      .text()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
  }

  async function detectRemote(preferred?: string) {
    const values = await remotes()
    if (preferred && values.includes(preferred)) return preferred
    if (values.includes("origin")) return "origin"
    if (values.length === 1) return values[0]
    if (values.includes("upstream")) return "upstream"
    return ""
  }

  async function candidate(root: string, input?: { name?: string; branch?: string; branchPrefix?: string }) {
    for (const attempt of Array.from({ length: 26 }, (_, i) => i)) {
      const base = input?.name
      const name = base ? (attempt === 0 ? base : `${base}-${randomName()}`) : randomName()
      const branch = input?.branch
        ? attempt === 0
          ? input.branch
          : `${input.branch}-${attempt}`
        : `${input?.branchPrefix || "nikcli"}/${name}`
      const directory = path.join(root, name)

      if (await exists(directory)) continue

      const ref = `refs/heads/${branch}`
      const branchCheck = await Git.run(["show-ref", "--verify", "--quiet", ref], { cwd: Instance.worktree })
      if (branchCheck.exitCode === 0) continue

      return Info.parse({ name, branch, directory })
    }

    throw new NameGenerationFailedError({ message: "Failed to generate a unique worktree name" })
  }

  async function runStartCommand(directory: string, cmd: string) {
    if (process.platform === "win32") {
      return $`cmd /c ${cmd}`.nothrow().cwd(directory)
    }
    return $`bash -lc ${cmd}`.nothrow().cwd(directory)
  }

  export const create = fn(CreateInput.optional(), async (input) => {
    if (Instance.project.vcs !== "git") {
      throw new NotGitError({ message: "Worktrees are only supported for git projects" })
    }

    const root = path.join(Global.Path.data, "worktree", Instance.project.id)
    await fs.mkdir(root, { recursive: true })

    const base = input?.name ? slug(input.name) : ""
    const explicitBranch = input?.branch ? branchName(input.branch) : ""
    const branchPrefix = input?.branchPrefix
      ?.split("/")
      .map((part) => slug(part))
      .filter(Boolean)
      .join("/")
    const info = await candidate(root, {
      name: base || undefined,
      branch: explicitBranch || undefined,
      branchPrefix: branchPrefix || undefined,
    })

    const remote = await detectRemote(input?.remote)
    const baseBranch = input?.baseBranch?.trim()
    const target = baseBranch ? (remote ? `${remote}/${baseBranch}` : baseBranch) : undefined

    if (baseBranch && remote) {
      const remoteHead = `refs/heads/${baseBranch}`
      const remoteTracking = `refs/remotes/${remote}/${baseBranch}`
      const fetchRefspec = `+${remoteHead}:${remoteTracking}`
      const fetch = await Git.run(["fetch", remote, fetchRefspec], { cwd: Instance.worktree })
      if (fetch.exitCode !== 0) {
        throw new CreateFailedError({ message: fetch.text().trim() || `Failed to fetch ${target}` })
      }
    }

    const created = target
      ? await Git.run(["worktree", "add", "-b", info.branch, info.directory, target], { cwd: Instance.worktree })
      : await Git.run(["worktree", "add", "-b", info.branch, info.directory], { cwd: Instance.worktree })
    if (created.exitCode !== 0) {
      throw new CreateFailedError({ message: created.text().trim() || "Failed to create git worktree" })
    }

    // Symlink node_modules from the main worktree so workspace packages (e.g. @nikcli-ai/plugin) resolve correctly
    const mainNodeModules = path.join(Instance.worktree, "node_modules")
    const worktreeNodeModules = path.join(info.directory, "node_modules")
    if ((await exists(mainNodeModules)) && !(await exists(worktreeNodeModules))) {
      const symlinkResult = await fs.symlink(mainNodeModules, worktreeNodeModules).catch((err) => {
        log.warn("symlink node_modules failed", { directory: info.directory, error: err?.message })
        return undefined
      })
      if (symlinkResult === undefined) {
        log.warn("node_modules symlink skipped, worktree may need manual setup", { directory: info.directory })
      }
    }

    const cmd = input?.startCommand?.trim()
    if (!cmd) return info

    try {
      const ran = await runStartCommand(info.directory, cmd)
      if (ran.exitCode !== 0) {
        throw new StartCommandFailedError({ message: errorText(ran) || "Worktree start command failed" })
      }
    } catch (err) {
      // Cleanup worktree on post-creation failure
      log.warn("post-creation failed, cleaning up worktree", { directory: info.directory, error: String(err) })
      try {
        await Git.run(["worktree", "remove", "--force", info.directory], { cwd: Instance.worktree })
      } catch (cleanupErr) {
        log.error("worktree cleanup failed", { directory: info.directory, error: String(cleanupErr) })
      }
      throw err
    }

    return info
  })

  export const remove = fn(RemoveInput, async (input) => {
    if (Instance.project.vcs !== "git") {
      throw new NotGitError({ message: "Worktrees are only supported for git projects" })
    }

    const directory = path.resolve(input.directory)
    const entry = await findWorktreeEntry(directory)
    if (!entry?.path) {
      throw new RemoveFailedError({ message: "Worktree not found" })
    }

    const removed = await Git.run(["worktree", "remove", "--force", entry.path], { cwd: Instance.worktree })
    if (removed.exitCode !== 0) {
      throw new RemoveFailedError({ message: removed.text().trim() || "Failed to remove git worktree" })
    }

    const branch = entry.branch?.replace(/^refs\/heads\//, "")
    if (branch) {
      const deleted = await Git.run(["branch", "-D", branch], { cwd: Instance.worktree })
      if (deleted.exitCode !== 0) {
        throw new RemoveFailedError({ message: deleted.text().trim() || "Failed to delete worktree branch" })
      }
    }

    return true
  })

  export const reset = fn(ResetInput, async (input) => {
    if (Instance.project.vcs !== "git") {
      throw new NotGitError({ message: "Worktrees are only supported for git projects" })
    }

    const directory = path.resolve(input.directory)
    if (directory === path.resolve(Instance.worktree)) {
      throw new ResetFailedError({ message: "Cannot reset the primary workspace" })
    }

    const entry = await findWorktreeEntry(directory)
    if (!entry?.path) {
      throw new ResetFailedError({ message: "Worktree not found" })
    }

    const worktreePath = entry.path

    const base = await Git.defaultBranch(Instance.worktree)
    if (!base) {
      throw new ResetFailedError({ message: "Default branch not found" })
    }

    const target = base.ref
    const remote = target.includes("/") ? target.split("/", 1)[0] : ""
    const remoteBranch = remote && target.startsWith(`${remote}/`) ? base.name : ""

    if (remote && remoteBranch) {
      const fetch = await Git.run(["fetch", remote, remoteBranch], { cwd: Instance.worktree })
      if (fetch.exitCode !== 0) {
        throw new ResetFailedError({ message: fetch.text().trim() || `Failed to fetch ${target}` })
      }
    }

    const resetToTarget = await Git.run(["reset", "--hard", target], { cwd: worktreePath })
    if (resetToTarget.exitCode !== 0) {
      throw new ResetFailedError({ message: resetToTarget.text().trim() || "Failed to reset worktree to target" })
    }

    const clean = await Git.run(["clean", "-fdx"], { cwd: worktreePath })
    if (clean.exitCode !== 0) {
      throw new ResetFailedError({ message: clean.text().trim() || "Failed to clean worktree" })
    }

    // Parallel submodule operations using Promise.allSettled
    const submoduleOps = await Promise.allSettled([
      Git.run(["submodule", "update", "--init", "--recursive", "--force"], { cwd: worktreePath }),
      Git.run(["submodule", "foreach", "--recursive", "git", "reset", "--hard"], { cwd: worktreePath }),
      Git.run(["submodule", "foreach", "--recursive", "git", "clean", "-fdx"], { cwd: worktreePath }),
    ])

    const failures = submoduleOps
      .map((result, index) => {
        if (result.status === "rejected") return { index, error: result.reason }
        if (result.status === "fulfilled" && result.value.exitCode !== 0) {
          return { index, error: result.value.text().trim() }
        }
        return null
      })
      .filter(Boolean)

    if (failures.length > 0) {
      const messages = failures.map((f) => {
        const names = ["submodule update", "submodule reset", "submodule clean"]
        return `${names[f!.index]}: ${f!.error}`
      })
      throw new ResetFailedError({ message: `Submodule operations failed:\n${messages.join("\n")}` })
    }

    const status = await Git.run(["status", "--porcelain=v1"], { cwd: worktreePath })
    if (status.exitCode !== 0) {
      throw new ResetFailedError({ message: status.text().trim() || "Failed to read git status" })
    }

    const dirty = status.text()
    if (!dirty) return true

    throw new ResetFailedError({ message: `Worktree reset left local changes:\n${dirty}` })
  })

  /**
   * List all worktrees in the current project.
   * Returns both the main worktree and any additional worktrees.
   */
  export const list = fn(z.object({}), async () => {
    if (Instance.project.vcs !== "git") {
      throw new NotGitError({ message: "Worktrees are only supported for git projects" })
    }
    return parseWorktrees()
  })
}
