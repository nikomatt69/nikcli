import { createHash } from "crypto"
import fs from "fs/promises"
import path from "path"
import { Global } from "@nikcli-ai/util/global"

export type GitHubRemote = {
  owner: string
  repo: string
}

export type NormalizedRepository =
  | {
      kind: "github"
      input: string
      owner: string
      repo: string
      cloneUrl: string
      cacheKey: string
    }
  | {
      kind: "git"
      input: string
      cloneUrl: string
      cacheKey: string
    }

export type ClonedRepository = {
  repository: NormalizedRepository
  directory: string
  cloned: boolean
  branch?: string
  commit?: string
}

export function parseGitHubRemote(url: string): GitHubRemote | null {
  const match = url.match(/^(?:(?:https?|ssh):\/\/)?(?:git@)?github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/)
  if (!match) return null
  return { owner: match[1], repo: match[2] }
}

export function normalizeRepository(input: string): NormalizedRepository {
  const value = input.trim()
  if (!value) throw new Error("repository is required")

  const shorthand = value.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/)
  const github = shorthand ? { owner: shorthand[1], repo: shorthand[2] } : parseGitHubRemote(value)
  if (github) {
    const repo = github.repo.replace(/\.git$/, "")
    const cloneUrl = `https://github.com/${github.owner}/${repo}.git`
    return {
      kind: "github",
      input: value,
      owner: github.owner,
      repo,
      cloneUrl,
      cacheKey: cacheKey(`github:${github.owner}/${repo}`),
    }
  }

  const cloneUrl = value.includes("://") || value.startsWith("git@") ? value : path.resolve(value)
  return {
    kind: "git",
    input: value,
    cloneUrl,
    cacheKey: cacheKey(`git:${cloneUrl}`),
  }
}

export function repositoryDirectory(repository: NormalizedRepository, branch?: string) {
  const branchPart = branch ? `-${safeSegment(branch)}` : ""
  return path.join(Global.Path.repos, `${repository.cacheKey}${branchPart}`)
}

export async function cloneOrUpdateRepository(input: {
  repository: string
  branch?: string
  signal?: AbortSignal
}): Promise<ClonedRepository> {
  const repository = normalizeRepository(input.repository)
  const directory = repositoryDirectory(repository, input.branch)
  await fs.mkdir(Global.Path.repos, { recursive: true })

  const exists = await fs
    .stat(path.join(directory, ".git"))
    .then((stat) => stat.isDirectory())
    .catch(() => false)

  if (!exists) {
    await fs.rm(directory, { recursive: true, force: true })
    const args = ["clone"]
    if (input.branch) args.push("--branch", input.branch, "--single-branch")
    args.push(repository.cloneUrl, directory)
    await runGit(args, { signal: input.signal })
  } else {
    await runGit(["fetch", "origin", "--prune"], { cwd: directory, signal: input.signal })
    if (input.branch) {
      await runGit(["checkout", input.branch], { cwd: directory, signal: input.signal })
      await runGit(["pull", "--ff-only"], { cwd: directory, signal: input.signal }).catch(() => undefined)
    }
  }

  const commit = await runGit(["rev-parse", "HEAD"], { cwd: directory, signal: input.signal }).catch(() => undefined)
  return {
    repository,
    directory,
    cloned: !exists,
    branch: input.branch,
    commit: commit?.trim(),
  }
}

export async function repositoryOverview(directory: string, options: { signal?: AbortSignal } = {}) {
  const [branch, commit, remote, files] = await Promise.all([
    runGit(["branch", "--show-current"], { cwd: directory, signal: options.signal }).catch(() => ""),
    runGit(["rev-parse", "HEAD"], { cwd: directory, signal: options.signal }).catch(() => ""),
    runGit(["remote", "get-url", "origin"], { cwd: directory, signal: options.signal }).catch(() => ""),
    runGit(["ls-files"], { cwd: directory, signal: options.signal }).catch(() => ""),
  ])
  const fileList = files
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)

  return {
    directory,
    branch: branch.trim() || undefined,
    commit: commit.trim() || undefined,
    remote: remote.trim() || undefined,
    fileCount: fileList.length,
    topLevel: summarizeTopLevel(fileList),
    sampleFiles: fileList.slice(0, 80),
  }
}

export async function runGit(
  args: string[],
  options: {
    cwd?: string
    signal?: AbortSignal
  } = {},
) {
  if (options.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError")

  const proc = Bun.spawn(["git", ...args], {
    windowsHide: true,
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
    },
  })

  const abort = new Promise<never>((_, reject) => {
    if (!options.signal) return
    options.signal.addEventListener(
      "abort",
      () => {
        proc.kill()
        reject(new DOMException("The operation was aborted.", "AbortError"))
      },
      { once: true },
    )
  })

  const [stdout, stderr, code] = await Promise.race([
    Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]),
    abort,
  ])
  if (code !== 0) {
    const detail = stderr.trim() || stdout.trim()
    throw new Error(`git ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`)
  }
  return stdout
}

function cacheKey(input: string) {
  const hash = createHash("sha256").update(input).digest("hex").slice(0, 12)
  return `${safeSegment(input)}-${hash}`
}

function safeSegment(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
}

function summarizeTopLevel(files: string[]) {
  const counts = new Map<string, number>()
  for (const file of files) {
    const top = file.split("/")[0]
    counts.set(top, (counts.get(top) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 30)
    .map(([name, count]) => ({ name, count }))
}
