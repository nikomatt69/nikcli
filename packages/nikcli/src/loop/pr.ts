/**
 * Loops — automatic GitHub PR creation on successful run.
 *
 * On `executeRun` finishing with `status: "complete"`, the engine delegates
 * here when the loop definition has `createPR: true`. This module is the
 * only place that knows about `gh`, push semantics, and branch naming; the
 * engine stays git-tool-agnostic.
 *
 * Best-effort contract:
 *   - No git repo, no `gh` CLI, or no remote => log a warning, return undefined.
 *   - No diffs to commit => log a warning, return undefined.
 *   - Any `gh`/git failure during push or PR creation => log a warning, return undefined.
 *   - A run only carries a `pullRequest` field when we actually opened/updated one.
 *
 * The returned `LoopPullRequestRef` is persisted onto the run record and
 * surfaced to clients via the runs DTO, so the TUI/mobile can deep-link
 * straight to the PR after a run completes.
 */

import { $ } from "bun"
import { Log } from "@nikcli-ai/util/log"
import { Git } from "../git"
import { parseGitHubRemote } from "../util/repository"
import type { LoopDefinition, LoopPullRequestRef, LoopRun } from "./schema"
import type { InstanceContext } from "@/effect"

const log = Log.create({ service: "loop.pr" })

/**
 * Branch name for a loop's automated PR. Stable per-loop (one PR per loop, not
 * per run) so a loop that runs repeatedly accumulates changes onto the same PR
 * instead of opening a new one every tick.
 */
export function pullRequestBranch(def: LoopDefinition): string {
  return `loop/${def.id}`
}

export type CreatePullRequestOptions = {
  /** The instance the loop belongs to: its vcs kind and worktree decide the push. */
  instance: InstanceContext
  def: LoopDefinition
  run: LoopRun
  /** Body text to use for the PR (auto-generated if undefined). */
  body?: string
  /**
   * Directory to push from. Defaults to the project worktree; sandboxed loops
   * pass their isolated worktree, which is where the work actually landed.
   */
  directory?: string
  /** Branch to push. Defaults to `loop/<id>`; sandboxed loops push their own branch. */
  branch?: string
}

/**
 * Push the loop's worktree to its branch and create (or update) a PR against
 * the repo's default branch. Returns the ref on success, or `undefined` if any
 * precondition fails (non-git, no diff, missing tool, etc.) — never throws.
 */
export async function createLoopPullRequest(opts: CreatePullRequestOptions): Promise<LoopPullRequestRef | undefined> {
  if (opts.instance.project.vcs !== "git") {
    log.info("createPR skipped: project is not a git repo", {
      loopID: opts.def.id,
    })
    return undefined
  }

  const cwd = opts.directory ?? opts.instance.worktree
  const branch = opts.branch ?? pullRequestBranch(opts.def)
  const base = await detectDefaultBranch(cwd)
  if (!base) {
    log.warn("createPR skipped: could not determine default branch", {
      loopID: opts.def.id,
    })
    return undefined
  }

  const remoteName = await detectRemote(cwd)
  if (!remoteName) {
    log.warn("createPR skipped: no git remote configured", {
      loopID: opts.def.id,
    })
    return undefined
  }

  const status = await Git.status(cwd)
  if (status.length === 0) {
    log.info("createPR skipped: no working-tree changes to commit", {
      loopID: opts.def.id,
    })
    return undefined
  }

  const title = `Loop: ${opts.def.name}`
  const body = opts.body ?? defaultPullRequestBody(opts.def, opts.run)

  // Stage + commit the in-flight changes. We use a generic author and let
  // GitHub display the bot/actor that pushed the branch.
  const commitArgs = [
    "-c",
    "user.name=nikcli[bot]",
    "-c",
    "user.email=nikcli[bot]@users.noreply.github.com",
    "commit",
    "--allow-empty",
    "-m",
    `loop(${opts.def.id}): ${opts.def.name}`,
    "-m",
    `Run ${opts.run.id} finished with status '${opts.run.status}'`,
  ]
  const addResult = await Git.run(["add", "--all"], { cwd })
  if (addResult.exitCode !== 0) {
    log.warn("createPR: git add failed", { stderr: addResult.text() })
    return undefined
  }
  const commitResult = await Git.run(commitArgs, { cwd })
  if (commitResult.exitCode !== 0) {
    log.warn("createPR: git commit failed", { stderr: commitResult.text() })
    return undefined
  }

  // Make sure the branch exists locally and points at the new commit, then
  // push it. We deliberately use `push -u` so the upstream is set on the first
  // push; subsequent calls are a fast-forward push.
  const checkoutResult = await Git.run(["checkout", "-B", branch], { cwd })
  if (checkoutResult.exitCode !== 0) {
    log.warn("createPR: git checkout failed", {
      stderr: checkoutResult.text(),
    })
    return undefined
  }
  const pushResult = await Git.run(["push", "-u", remoteName, branch, "--no-verify"], { cwd })
  if (pushResult.exitCode !== 0) {
    log.warn("createPR: git push failed", { stderr: pushResult.text() })
    return undefined
  }

  // If a PR is already open for this branch, update it; otherwise create one.
  const existing = await ghJson<Array<{ number: number; html_url: string; title: string }>>(
    [
      "pr",
      "list",
      "--head",
      branch,
      "--base",
      base,
      "--state",
      "open",
      "--json",
      "number,html_url,title",
      "--limit",
      "1",
    ],
    cwd,
  )
  if (existing && existing.length > 0) {
    const current = existing[0]!
    const editResult = await $`gh pr edit ${current.number} --title ${title} --body ${body}`.nothrow()
    if (editResult.exitCode !== 0) {
      const stderr = editResult.stderr.toString("utf8")
      log.warn("createPR: gh pr edit failed", { stderr })
      return undefined
    }
    log.info("updated existing PR for loop", {
      loopID: opts.def.id,
      number: current.number,
    })
    return {
      number: current.number,
      url: current.html_url,
      branch,
      base,
      title: current.title,
      action: "updated",
    }
  }

  const createResult = await $`gh pr create --head ${branch} --base ${base} --title ${title} --body ${body}`.nothrow()
  if (createResult.exitCode !== 0) {
    const stderr = createResult.stderr.toString("utf8")
    log.warn("createPR: gh pr create failed", { stderr })
    return undefined
  }
  const url = createResult.stdout.toString("utf8").trim()
  // gh emits the PR URL on stdout and exits 0; we still try to resolve the
  // number from the API for a stable reference.
  const view = await ghJson<{
    number: number
    html_url: string
    title: string
  }>(["pr", "view", url, "--json", "number,html_url,title"], cwd)
  log.info("created PR for loop", {
    loopID: opts.def.id,
    url,
    number: view?.number,
  })
  return {
    number: view?.number ?? 0,
    url: view?.html_url ?? url,
    branch,
    base,
    title: view?.title ?? title,
    action: "created",
  }
}

function defaultPullRequestBody(def: LoopDefinition, run: LoopRun): string {
  const lines = [
    `Automated PR opened by the \`${def.name}\` loop.`,
    "",
    `- Loop ID: \`${def.id}\``,
    `- Run ID: \`${run.id}\``,
    `- Status: \`${run.status}\``,
    ...(run.sessionID ? `- Session: \`${run.sessionID}\`` : []),
    "",
    "Generated by nikcli.",
  ]
  return lines.join("\n")
}

async function detectDefaultBranch(cwd: string): Promise<string | undefined> {
  const base = await Git.defaultBranch(cwd)
  if (base?.name) return base.name
  // Fall back to whatever `gh` knows (origin/HEAD).
  const result = await $`gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`.nothrow()
  if (result.exitCode === 0) {
    const name = result.stdout.toString("utf8").trim()
    if (name) return name
  }
  return undefined
}

async function detectRemote(cwd: string): Promise<string | undefined> {
  const url = await Git.run(["remote", "get-url", "origin"], { cwd })
  if (url.exitCode !== 0) {
    const text = url.text().trim()
    if (text) return "origin"
    return undefined
  }
  const value = url.text().trim()
  const parsed = parseGitHubRemote(value)
  if (!parsed) {
    log.warn("createPR: origin remote is not a GitHub URL", { remote: value })
    return undefined
  }
  return "origin"
}

/** Run `gh <args> --json <fields>` and parse the first element. */
async function ghJson<T>(args: string[], _cwd: string): Promise<T | undefined> {
  if (!(await hasGh())) return undefined
  const result = await $`gh ${args}`.nothrow()
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString("utf8")
    log.debug("gh command failed", { args, stderr })
    return undefined
  }
  const text = result.stdout.toString("utf8").trim()
  if (!text) return undefined
  try {
    // SAFETY: every caller passes `--json <fields>` and instantiates `T` with
    // exactly those fields (see the `pr list` / `pr view` call sites), so the
    // shape is the documented contract of that flag rather than an unchecked
    // guess. A body that is not JSON at all throws and is caught here.
    return JSON.parse(text) as T
  } catch (error) {
    log.debug("gh json parse failed", { args, error })
    return undefined
  }
}

let cachedHasGh: boolean | undefined
async function hasGh(): Promise<boolean> {
  if (cachedHasGh !== undefined) return cachedHasGh
  const result = await $`gh --version`.nothrow()
  cachedHasGh = result.exitCode === 0
  return cachedHasGh
}
