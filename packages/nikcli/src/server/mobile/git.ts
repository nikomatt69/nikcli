import { MobileGithubRepo } from "@/mobile/github-repo"
import { githubToken } from "./helpers"
import { MobileHttpError } from "./request"

function parseNumstat(output: string) {
  const stats = new Map<string, { additions: number; deletions: number }>()
  for (const line of output.split("\n")) {
    const [a, d, ...parts] = line.split("\t")
    const file = parts.join("\t").trim()
    if (file)
      stats.set(file, {
        additions: a === "-" ? 0 : Number.parseInt(a, 10) || 0,
        deletions: d === "-" ? 0 : Number.parseInt(d, 10) || 0,
      })
  }
  return stats
}

function parseFileDiffs(output: string) {
  const results: Array<{
    file: string
    oldPath?: string
    hunks: Array<{
      header: { oldStart: number; oldLines: number; newStart: number; newLines: number }
      lines: Array<{ type: "add" | "remove" | "context"; text: string; oldLineNumber?: number; newLineNumber?: number }>
    }>
    isBinary: boolean
    additions: number
    deletions: number
  }> = []
  for (const block of output.split(/(?=^diff --git )/m).filter((part) => part.startsWith("diff --git "))) {
    const match = block.match(/^diff --git a\/(.*) b\/(.*)$/m)
    if (!match) continue
    const [, oldPath, newPath] = match
    const renamed = oldPath !== newPath && block.includes("rename from")
    if (block.includes("Binary files")) {
      results.push({
        file: newPath || oldPath,
        oldPath: renamed ? oldPath : undefined,
        hunks: [],
        isBinary: true,
        additions: 0,
        deletions: 0,
      })
      continue
    }
    const hunks: (typeof results)[number]["hunks"] = []
    let current: (typeof hunks)[number] | undefined,
      oldLine = 0,
      newLine = 0,
      additions = 0,
      deletions = 0
    for (const line of block.split("\n")) {
      const h = line.match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/)
      if (h) {
        oldLine = +h[1]
        newLine = +h[3]
        current = {
          header: { oldStart: oldLine, oldLines: +(h[2] || "1"), newStart: newLine, newLines: +(h[4] || "1") },
          lines: [],
        }
        hunks.push(current)
        continue
      }
      if (!current || line.startsWith("\\")) continue
      if (line.startsWith("+") && !line.startsWith("+++")) {
        current.lines.push({ type: "add", text: line.slice(1), newLineNumber: newLine++ })
        additions++
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        current.lines.push({ type: "remove", text: line.slice(1), oldLineNumber: oldLine++ })
        deletions++
      } else if (line.startsWith(" "))
        current.lines.push({ type: "context", text: line.slice(1), oldLineNumber: oldLine++, newLineNumber: newLine++ })
    }
    results.push({
      file: newPath || oldPath,
      oldPath: renamed ? oldPath : undefined,
      hunks,
      isBinary: false,
      additions,
      deletions,
    })
  }
  return results
}

export async function gitStatus(directory: string) {
  const token = (await githubToken()) ?? undefined
  const git = (args: string[]) => MobileGithubRepo.runGit(args, { cwd: directory, token })
  const [porcelain, branch, counts, stagedRaw, unstagedRaw] = await Promise.all([
    git(["status", "--porcelain", "-uall"]),
    git(["branch", "--show-current"]),
    git(["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]).catch(() => "0 0"),
    git(["diff", "--cached", "--numstat"]).catch(() => ""),
    git(["diff", "--numstat"]).catch(() => ""),
  ])
  type Change = {
    status: "added" | "modified" | "deleted" | "renamed"
    path: string
    oldPath?: string
    additions?: number
    deletions?: number
  }
  const staged: Change[] = [],
    unstaged: Change[] = [],
    untracked: string[] = [],
    ss = parseNumstat(stagedRaw),
    us = parseNumstat(unstagedRaw)
  const kind = (code: string) => (({ A: "added", M: "modified", D: "deleted", R: "renamed" }) as const)[code as "A"]
  for (const line of porcelain.split("\n").filter(Boolean)) {
    const raw = line.slice(3),
      arrow = raw.indexOf(" -> "),
      file = arrow < 0 ? raw : raw.slice(arrow + 4),
      oldPath = arrow < 0 ? undefined : raw.slice(0, arrow)
    if (line.slice(0, 2) === "??") {
      untracked.push(file)
      continue
    }
    const add = (list: Change[], code: string, stats: Map<string, { additions: number; deletions: number }>) => {
      const status = kind(code)
      if (status) list.push({ status, path: file, oldPath, ...(stats.get(file) ?? { additions: 0, deletions: 0 }) })
    }
    add(staged, line[0] ?? " ", ss)
    add(unstaged, line[1] ?? " ", us)
  }
  const [behind = "0", ahead = "0"] = counts.trim().split(/\s+/)
  let lastCommit: { sha: string; message: string; author: string; timestamp: number } | undefined
  try {
    const lines = (await git(["log", "-1", "--format=%H%n%s%n%an%n%ae%n%at"])).split("\n")
    if (lines.length >= 5)
      lastCommit = { sha: lines[0], message: lines[1], author: lines[2], timestamp: +lines[4] * 1000 }
  } catch {}
  return {
    branch: branch.trim(),
    staged,
    unstaged,
    untracked,
    commitsAhead: +ahead || 0,
    commitsBehind: +behind || 0,
    lastCommit,
  }
}

export async function gitDiff(directory: string, query: { file?: string; staged?: "true" | "false" }) {
  const token = (await githubToken()) ?? undefined
  const git = (args: string[]) => MobileGithubRepo.runGit(args, { cwd: directory, token })
  const args = ["diff", "--no-color", "-U1000"]
  if (query.staged === "true") args.push("--cached")
  if (query.file) args.push("--", query.file)
  return parseFileDiffs(await git(args))
}

export async function gitBranches(directory: string) {
  const token = (await githubToken()) ?? undefined
  const git = (args: string[]) => MobileGithubRepo.runGit(args, { cwd: directory, token })
  const output = await git(["branch", "-a", "-v"])
  return output.split("\n").flatMap((line) => {
    const m = line.match(/^([* ])\s*(\S+)\s*([a-f0-9]+)?\s*(.*)$/)
    if (!m || m[2].startsWith("->") || m[2].includes("HEAD")) return []
    return [
      {
        name: m[2],
        isCurrent: m[1] === "*",
        isProtected: ["main", "master", "develop"].includes(m[2]),
        aheadBy: +(m[4].match(/ahead (\d+)/)?.[1] ?? 0),
        behindBy: +(m[4].match(/behind (\d+)/)?.[1] ?? 0),
      },
    ]
  })
}

export async function gitCommits(directory: string, query: { limit?: number }) {
  const token = (await githubToken()) ?? undefined
  const git = (args: string[]) => MobileGithubRepo.runGit(args, { cwd: directory, token })
  const output = await git([
    "log",
    "--no-color",
    "--format=%H%x1f%s%x1f%an%x1f%ae%x1f%at%x1e",
    "-n",
    String(query.limit ?? 50),
  ])
  const result = []
  for (const block of output.split("\x1e")) {
    const f = block.trim().split("\x1f")
    if (f.length < 5) continue
    const stats = parseNumstat(await git(["show", "--numstat", "--no-color", "--format=", f[0].trim()]).catch(() => ""))
    let additions = 0,
      deletions = 0
    for (const s of stats.values()) {
      additions += s.additions
      deletions += s.deletions
    }
    result.push({
      sha: f[0].trim(),
      message: f[1],
      author: { name: f[2], email: f[3] },
      timestamp: +f[4] * 1000,
      filesCount: stats.size,
      additions,
      deletions,
    })
  }
  return result
}

export async function gitCommit(
  directory: string,
  input: {
    message: string
    files?: readonly string[]
    amend?: boolean
    stagedOnly?: boolean
  },
) {
  const token = (await githubToken()) ?? undefined
  const git = (args: string[]) => MobileGithubRepo.runGit(args, { cwd: directory, token })
  if (!input.stagedOnly) await git(input.files?.length ? ["add", "--", ...input.files] : ["add", "-A"])
  if (!(await git(["diff", "--cached", "--name-only"])).trim() && !input.amend)
    throw new MobileHttpError("No changes to commit", 400)
  await git(input.amend ? ["commit", "--amend", "--no-edit"] : ["commit", "-m", input.message])
  return {
    sha: (await git(["rev-parse", "HEAD"])).trim(),
    message: input.amend ? await git(["log", "-1", "--format=%s"]) : input.message,
  }
}

export async function gitCheckout(directory: string, input: { branch: string; create?: boolean }) {
  const token = (await githubToken()) ?? undefined
  const git = (args: string[]) => MobileGithubRepo.runGit(args, { cwd: directory, token })
  await git(input.create ? ["checkout", "-b", input.branch] : ["checkout", input.branch])
  return { success: true as const }
}

export async function gitFiles(
  directory: string,
  input: { files: readonly string[] },
  op: "stage" | "unstage" | "discard",
) {
  const token = (await githubToken()) ?? undefined
  const git = (args: string[]) => MobileGithubRepo.runGit(args, { cwd: directory, token })
  const args = op === "stage" ? ["add", "--"] : op === "unstage" ? ["reset", "HEAD", "--"] : ["checkout", "--"]
  await git([...args, ...input.files])
  return { success: true as const }
}

export async function gitPush(directory: string, query: { upstream?: string }) {
  const token = (await githubToken()) ?? undefined
  const git = (args: string[]) => MobileGithubRepo.runGit(args, { cwd: directory, token })
  const branch = query.upstream ?? (await git(["branch", "--show-current"])).trim()
  return git(["push", "--set-upstream", "origin", branch]).then(
    () => ({ success: true as const, pushed: true }),
    () => ({ success: true as const, pushed: false }),
  )
}

export async function gitPull(directory: string) {
  const token = (await githubToken()) ?? undefined
  const git = (args: string[]) => MobileGithubRepo.runGit(args, { cwd: directory, token })
  try {
    await git(["fetch", "origin"])
    await git(["pull", "--no-rebase"])
    return { success: true as const, pulled: true }
  } catch (error) {
    if (String(error).toLowerCase().includes("conflict")) {
      const conflicts = (await git(["status", "--porcelain"]))
        .split("\n")
        .filter((line) => /^(UU|AA|DD)/.test(line))
        .map((line) => line.slice(4))
      return { success: true as const, pulled: false, conflicts }
    }
    return { success: true as const, pulled: false }
  }
}
