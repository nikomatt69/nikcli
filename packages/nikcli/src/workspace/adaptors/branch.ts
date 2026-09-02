import { Git } from "@/git"
import { Log } from "@nikcli-ai/util/log"
import { InstanceState } from "@/effect"
import type { Config } from "../config"
import type { Adaptor } from "./types"

const log = Log.create({ service: "branch.adaptor" })

type BranchConfig = Extract<Config, { type: "branch" }>

/**
 * In-place branch workspace (no separate directory): creating one makes a
 * dedicated git branch in the project's primary checkout and switches to it,
 * and every restore re-runs `git switch`, so the branch the user sees in
 * external tools (VS Code, terminals) follows the workspace switch. This is
 * the counterpart to the worktree adaptor for users who want the *main*
 * checkout to move, accepting that only one branch workspace can be active
 * at a time.
 */

function slug(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
}

function branchName(input: string) {
  return input
    .split("/")
    .map((part) => slug(part))
    .filter(Boolean)
    .join("/")
}

function projectRoot(): { directory: string; vcs?: string } {
  const ctx = InstanceState.ambient()
  return { directory: ctx.worktree, vcs: ctx.project.vcs }
}

const ADJECTIVES = [
  "amber",
  "brisk",
  "calm",
  "crisp",
  "dapper",
  "frosty",
  "gentle",
  "glimmering",
  "humble",
  "jovial",
  "lively",
  "nimble",
  "placid",
  "radiant",
  "serene",
  "stellar",
  "sturdy",
  "sunny",
  "swift",
  "vivid",
] as const

const NOUNS = [
  "comet",
  "crater",
  "ember",
  "falcon",
  "forest",
  "harbor",
  "horizon",
  "island",
  "meadow",
  "meteor",
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

function generateName() {
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}`
}

async function branchExists(cwd: string, branch: string) {
  const result = await Git.run(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { cwd })
  return result.exitCode === 0
}

async function switchTo(cwd: string, branch: string) {
  const current = await Git.branch(cwd)
  if (current === branch) return
  const result = await Git.run(["switch", branch], { cwd })
  if (result.exitCode !== 0) {
    const message = result.stderr.toString("utf8").trim() || result.text().trim() || `Failed to switch to ${branch}`
    throw new Error(message)
  }
  log.info("switched primary checkout", { cwd, branch })
}

export const BranchAdaptor: Adaptor<BranchConfig> = {
  name: "Branch",
  description: "Switch this checkout to a dedicated git branch (in place)",
  async create(_from: BranchConfig, branch: string | null | undefined, _workspaceID?: string) {
    const root = projectRoot()
    if (root.vcs !== "git") throw new Error("Branch workspaces are only supported for git projects")
    const cwd = root.directory

    const explicit = branch ? branchName(branch) : ""
    let name = ""
    let ref = ""
    for (let attempt = 0; attempt < 26; attempt++) {
      const candidateRef = explicit ? (attempt === 0 ? explicit : `${explicit}-${attempt}`) : `nikcli/${generateName()}`
      if (await branchExists(cwd, candidateRef)) continue
      ref = candidateRef
      name = candidateRef.split("/").filter(Boolean).pop() ?? candidateRef
      break
    }
    if (!ref) throw new Error("Failed to generate a unique branch name")

    return {
      name,
      branch: ref,
      config: {
        type: "branch" as const,
        directory: cwd,
        branch: ref,
        eventLimit: _from.eventLimit,
      },
      init: async () => {
        const created = await Git.run(["branch", ref], { cwd })
        if (created.exitCode !== 0) {
          const message = created.stderr.toString("utf8").trim() || `Failed to create branch ${ref}`
          throw new Error(message)
        }
        await switchTo(cwd, ref)
      },
    }
  },
  async restore(config: BranchConfig) {
    if (!config.branch) return
    if (!(await branchExists(config.directory, config.branch))) {
      throw new Error(`Branch not found: ${config.branch}`)
    }
    await switchTo(config.directory, config.branch)
  },
  async remove(config: BranchConfig) {
    if (!config.branch) return
    const cwd = config.directory
    if (!(await branchExists(cwd, config.branch))) return
    const current = await Git.branch(cwd)
    if (current === config.branch) {
      const base = await Git.defaultBranch(cwd)
      if (!base) throw new Error("Cannot delete the active branch: no default branch to switch back to")
      await switchTo(cwd, base.name)
    }
    const deleted = await Git.run(["branch", "-D", config.branch], { cwd })
    if (deleted.exitCode !== 0) {
      const message = deleted.stderr.toString("utf8").trim() || `Failed to delete branch ${config.branch}`
      throw new Error(message)
    }
  },
  target(config: BranchConfig) {
    return { type: "local" as const, directory: config.directory }
  },
  async healthCheck(config: BranchConfig) {
    if (!config.branch) return false
    const healthy = await branchExists(config.directory, config.branch)
    if (!healthy)
      log.warn("healthCheck: branch missing", {
        branch: config.branch,
        directory: config.directory,
      })
    return healthy
  },
}
