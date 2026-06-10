import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Instance } from "@/project/instance"
import { MobileGithubRepo } from "@/mobile/github-repo"
import { errors } from "../../error"
import { withInstanceAsync } from "@/effect"
import { githubToken } from "./helpers"

export const GitRoutes = () =>
  new Hono()
    .get(
      "/git/status",
      describeRoute({
        summary: "Get git status for mobile",
        description: "Return the current git state including branch, staged/unstaged changes, and untracked files.",
        operationId: "mobile.git.status",
        responses: {
          200: {
            description: "Git status",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    branch: z.string(),
                    staged: z.array(
                      z.union([
                        z.object({
                          status: z.literal("added"),
                          path: z.string(),
                          additions: z.number(),
                          deletions: z.number(),
                        }),
                        z.object({
                          status: z.literal("modified"),
                          path: z.string(),
                          additions: z.number(),
                          deletions: z.number(),
                        }),
                        z.object({ status: z.literal("deleted"), path: z.string() }),
                        z.object({ status: z.literal("renamed"), path: z.string(), oldPath: z.string() }),
                      ]),
                    ),
                    unstaged: z.array(
                      z.union([
                        z.object({
                          status: z.literal("added"),
                          path: z.string(),
                          additions: z.number(),
                          deletions: z.number(),
                        }),
                        z.object({
                          status: z.literal("modified"),
                          path: z.string(),
                          additions: z.number(),
                          deletions: z.number(),
                        }),
                        z.object({ status: z.literal("deleted"), path: z.string() }),
                        z.object({ status: z.literal("renamed"), path: z.string(), oldPath: z.string() }),
                      ]),
                    ),
                    untracked: z.array(z.string()),
                    commitsAhead: z.number(),
                    commitsBehind: z.number(),
                    lastCommit: z
                      .object({ sha: z.string(), message: z.string(), author: z.string(), timestamp: z.number() })
                      .optional(),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        return withInstanceAsync({ directory: Instance.directory }, async () => {
          const token = (await githubToken()) ?? undefined
          const [statusOutput, branchOutput, aheadBehind, stagedNumstat, unstagedNumstat] = await Promise.all([
            MobileGithubRepo.runGit(["status", "--porcelain", "-uall"], {
              cwd: Instance.directory,
              token,
            }) as Promise<string>,
            MobileGithubRepo.runGit(["branch", "--show-current"], {
              cwd: Instance.directory,
              token,
            }) as Promise<string>,
            MobileGithubRepo.runGit(["rev-list", "--left-right", "--count", "@{upstream}...HEAD"], {
              cwd: Instance.directory,
              token,
            }).catch(() => "0 0") as Promise<string>,
            MobileGithubRepo.runGit(["diff", "--cached", "--numstat"], { cwd: Instance.directory, token }).catch(
              () => "",
            ) as Promise<string>,
            MobileGithubRepo.runGit(["diff", "--numstat"], { cwd: Instance.directory, token }).catch(
              () => "",
            ) as Promise<string>,
          ])

          const [behind = "0", ahead = "0"] = aheadBehind.trim().split(/\s+/)
          const commitsAhead = Number.parseInt(ahead, 10) || 0
          const commitsBehind = Number.parseInt(behind, 10) || 0

          const staged: Array<{
            status: string
            path: string
            additions?: number
            deletions?: number
            oldPath?: string
          }> = []
          const unstaged: Array<{
            status: string
            path: string
            additions?: number
            deletions?: number
            oldPath?: string
          }> = []
          const untracked: string[] = []
          const stagedStats = parseNumstat(stagedNumstat)
          const unstagedStats = parseNumstat(unstagedNumstat)

          function changeStatus(code: string): "added" | "modified" | "deleted" | "renamed" | undefined {
            if (code === "A") return "added"
            if (code === "M") return "modified"
            if (code === "D") return "deleted"
            if (code === "R") return "renamed"
            return undefined
          }

          function parsePorcelainPath(value: string) {
            const arrowIndex = value.indexOf(" -> ")
            if (arrowIndex === -1) return { path: value }
            return { oldPath: value.slice(0, arrowIndex), path: value.slice(arrowIndex + 4) }
          }

          const lines = statusOutput.split("\n").filter(Boolean)
          for (const line of lines) {
            const index = line[0] ?? " "
            const worktree = line[1] ?? " "
            const rawPath = line.slice(3)
            const { path, oldPath } = parsePorcelainPath(rawPath)

            if (index === "?" && worktree === "?") {
              untracked.push(path)
              continue
            }

            if (index === "!" && worktree === "!") continue

            const stagedStatus = changeStatus(index)
            if (stagedStatus) {
              const parsed = stagedStats.get(path) ?? { additions: 0, deletions: 0 }
              staged.push({
                status: stagedStatus,
                path,
                oldPath,
                additions: parsed.additions,
                deletions: parsed.deletions,
              })
            }

            const unstagedStatus = changeStatus(worktree)
            if (unstagedStatus) {
              const parsed = unstagedStats.get(path) ?? { additions: 0, deletions: 0 }
              unstaged.push({
                status: unstagedStatus,
                path,
                oldPath,
                additions: parsed.additions,
                deletions: parsed.deletions,
              })
            }
          }

          let lastCommit: { sha: string; message: string; author: string; timestamp: number } | undefined
          try {
            const logOutput = await MobileGithubRepo.runGit(["log", "-1", "--format=%H%n%s%n%an%n%ae%n%at"], {
              cwd: Instance.directory,
              token,
            })
            const logLines = logOutput.split("\n")
            if (logLines.length >= 5) {
              lastCommit = {
                sha: logLines[0],
                message: logLines[1],
                author: logLines[2],
                timestamp: Number.parseInt(logLines[4], 10) * 1000,
              }
            }
          } catch {}

          return c.json({
            branch: branchOutput.trim(),
            staged,
            unstaged,
            untracked,
            commitsAhead,
            commitsBehind,
            lastCommit,
          })
        })
      },
    )
    .get(
      "/git/diff",
      describeRoute({
        summary: "Get git diff for mobile",
        description: "Return parsed file diffs with hunks for the current git state.",
        operationId: "mobile.git.diff",
        responses: {
          200: {
            description: "File diffs",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      file: z.string(),
                      oldPath: z.string().optional(),
                      hunks: z.array(
                        z.object({
                          header: z.object({
                            oldStart: z.number(),
                            oldLines: z.number(),
                            newStart: z.number(),
                            newLines: z.number(),
                          }),
                          lines: z.array(
                            z.object({
                              type: z.enum(["add", "remove", "context"]),
                              text: z.string(),
                              oldLineNumber: z.number().optional(),
                              newLineNumber: z.number().optional(),
                            }),
                          ),
                        }),
                      ),
                      isBinary: z.boolean(),
                      additions: z.number(),
                      deletions: z.number(),
                    }),
                  ),
                ),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({ file: z.string().optional(), staged: z.enum(["true", "false"]).optional() }).optional(),
      ),
      async (c) => {
        return withInstanceAsync({ directory: Instance.directory }, async () => {
          const token = (await githubToken()) ?? undefined
          const query = c.req.valid("query")
          const args = ["diff", "--no-color", "-U1000"]
          if (query?.staged === "true") args.push("--cached")
          if (query?.file) {
            args.push("--", query.file)
          }

          const output = await MobileGithubRepo.runGit(args, { cwd: Instance.directory, token })
          return c.json(parseFileDiffs(output))
        })
      },
    )
    .get(
      "/git/commits",
      describeRoute({
        summary: "Get git commit history for mobile",
        description: "Return recent commits with stats for the current branch.",
        operationId: "mobile.git.commits",
        responses: {
          200: {
            description: "Commits",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      sha: z.string(),
                      message: z.string(),
                      author: z.object({ name: z.string(), email: z.string() }),
                      timestamp: z.number(),
                      filesCount: z.number(),
                      additions: z.number(),
                      deletions: z.number(),
                    }),
                  ),
                ),
              },
            },
          },
        },
      }),
      validator("query", z.object({ limit: z.coerce.number().default(50) }).optional()),
      async (c) => {
        return withInstanceAsync({ directory: Instance.directory }, async () => {
          const token = (await githubToken()) ?? undefined
          const query = c.req.valid("query")
          const limit = query?.limit ?? 50

          const output = await MobileGithubRepo.runGit(
            ["log", "--no-color", "--format=%H%x1f%s%x1f%an%x1f%ae%x1f%at%x1e", "-n", String(limit)],
            { cwd: Instance.directory, token },
          )

          const commits: Array<{
            sha: string
            message: string
            author: { name: string; email: string }
            timestamp: number
            filesCount: number
            additions: number
            deletions: number
          }> = []
          const commitBlocks = output.split("\x1e")
          for (const block of commitBlocks) {
            const fields = block.trim().split("\x1f")
            if (fields.length < 5) continue
            const [sha, message, authorName, authorEmail, timestamp] = fields
            const timestampMs = Number.parseInt(timestamp, 10) * 1000

            const statOutput = await MobileGithubRepo.runGit(
              ["show", "--numstat", "--no-color", "--format=", sha.trim()],
              {
                cwd: Instance.directory,
                token,
              },
            ).catch(() => "")

            const { filesCount, additions, deletions } = parseCommitStat(statOutput)

            commits.push({
              sha: sha.trim(),
              message,
              author: { name: authorName, email: authorEmail },
              timestamp: timestampMs,
              filesCount,
              additions,
              deletions,
            })
          }

          return c.json(commits)
        })
      },
    )
    .get(
      "/git/branches",
      describeRoute({
        summary: "Get git branches for mobile",
        description: "Return local and remote branches with status.",
        operationId: "mobile.git.branches",
        responses: {
          200: {
            description: "Branches",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      name: z.string(),
                      isCurrent: z.boolean(),
                      isProtected: z.boolean(),
                      aheadBy: z.number(),
                      behindBy: z.number(),
                    }),
                  ),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        return withInstanceAsync({ directory: Instance.directory }, async () => {
          const token = (await githubToken()) ?? undefined
          const branchOutput = await MobileGithubRepo.runGit(["branch", "-a", "-v"], {
            cwd: Instance.directory,
            token,
          })
          const branches: Array<{
            name: string
            isCurrent: boolean
            isProtected: boolean
            aheadBy: number
            behindBy: number
          }> = []

          const branchLines = branchOutput.split("\n").filter(Boolean)
          for (const line of branchLines) {
            const match = line.match(/^([* ])\s*(\S+)\s*([a-f0-9]+)?\s*(.*)$/)
            if (!match) continue
            const [, indicator, name, , rest] = match
            if (name.startsWith("->") || name.includes("HEAD")) continue

            const ahead = rest.match(/ahead (\d+)/)?.[1] ?? "0"
            const behind = rest.match(/behind (\d+)/)?.[1] ?? "0"

            branches.push({
              name,
              isCurrent: indicator === "*",
              isProtected: name === "main" || name === "master" || name === "develop",
              aheadBy: Number.parseInt(ahead, 10) || 0,
              behindBy: Number.parseInt(behind, 10) || 0,
            })
          }

          return c.json(branches)
        })
      },
    )
    .post(
      "/git/commit",
      describeRoute({
        summary: "Create git commit for mobile",
        description: "Stage and commit changes in the current worktree.",
        operationId: "mobile.git.commit",
        responses: {
          200: {
            description: "Commit created",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    sha: z.string(),
                    message: z.string(),
                  }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          message: z.string().min(1),
          files: z.array(z.string()).optional(),
          amend: z.boolean().optional(),
          stagedOnly: z.boolean().optional(),
        }),
      ),
      async (c) => {
        return withInstanceAsync({ directory: Instance.directory }, async () => {
          const token = (await githubToken()) ?? undefined
          const body = c.req.valid("json")
          const args = body.amend ? ["commit", "--amend", "--no-edit"] : ["commit", "-m", body.message]

          if (!body.stagedOnly) {
            if (body.files?.length) {
              await MobileGithubRepo.runGit(["add", "--", ...body.files], { cwd: Instance.directory, token })
            } else {
              await MobileGithubRepo.runGit(["add", "-A"], { cwd: Instance.directory, token })
            }
          }

          const statusOutput = await MobileGithubRepo.runGit(["diff", "--cached", "--name-only"], {
            cwd: Instance.directory,
            token,
          })
          if (!statusOutput.trim() && !body.amend) {
            return c.json({ error: "No changes to commit" }, 400)
          }

          await MobileGithubRepo.runGit(args, { cwd: Instance.directory, token })
          const sha = await MobileGithubRepo.runGit(["rev-parse", "HEAD"], { cwd: Instance.directory, token })
          const message = body.amend
            ? await MobileGithubRepo.runGit(["log", "-1", "--format=%s"], { cwd: Instance.directory, token })
            : body.message

          return c.json({ sha: sha.trim(), message })
        })
      },
    )
    .post(
      "/git/checkout",
      describeRoute({
        summary: "Checkout git branch for mobile",
        description: "Switch to a different branch in the current worktree.",
        operationId: "mobile.git.checkout",
        responses: {
          200: {
            description: "Branch switched",
            content: { "application/json": { schema: resolver(z.object({ success: z.literal(true) })) } },
          },
          ...errors(400),
        },
      }),
      validator("json", z.object({ branch: z.string().min(1), create: z.boolean().optional() })),
      async (c) => {
        return withInstanceAsync({ directory: Instance.directory }, async () => {
          const token = (await githubToken()) ?? undefined
          const body = c.req.valid("json")
          const args = body.create ? ["checkout", "-b", body.branch] : ["checkout", body.branch]
          await MobileGithubRepo.runGit(args, { cwd: Instance.directory, token })
          return c.json({ success: true as const })
        })
      },
    )
    .post(
      "/git/stage",
      describeRoute({
        summary: "Stage git files for mobile",
        description: "Add files to the staging area.",
        operationId: "mobile.git.stage",
        responses: {
          200: {
            description: "Files staged",
            content: { "application/json": { schema: resolver(z.object({ success: z.literal(true) })) } },
          },
        },
      }),
      validator("json", z.object({ files: z.array(z.string()) })),
      async (c) => {
        return withInstanceAsync({ directory: Instance.directory }, async () => {
          const token = (await githubToken()) ?? undefined
          const body = c.req.valid("json")
          await MobileGithubRepo.runGit(["add", "--", ...body.files], { cwd: Instance.directory, token })
          return c.json({ success: true as const })
        })
      },
    )
    .post(
      "/git/unstage",
      describeRoute({
        summary: "Unstage git files for mobile",
        description: "Remove files from the staging area.",
        operationId: "mobile.git.unstage",
        responses: {
          200: {
            description: "Files unstaged",
            content: { "application/json": { schema: resolver(z.object({ success: z.literal(true) })) } },
          },
        },
      }),
      validator("json", z.object({ files: z.array(z.string()) })),
      async (c) => {
        return withInstanceAsync({ directory: Instance.directory }, async () => {
          const token = (await githubToken()) ?? undefined
          const body = c.req.valid("json")
          await MobileGithubRepo.runGit(["reset", "HEAD", "--", ...body.files], { cwd: Instance.directory, token })
          return c.json({ success: true as const })
        })
      },
    )
    .post(
      "/git/discard",
      describeRoute({
        summary: "Discard git changes for mobile",
        description: "Discard uncommitted changes to files.",
        operationId: "mobile.git.discard",
        responses: {
          200: {
            description: "Changes discarded",
            content: { "application/json": { schema: resolver(z.object({ success: z.literal(true) })) } },
          },
        },
      }),
      validator("json", z.object({ files: z.array(z.string()) })),
      async (c) => {
        return withInstanceAsync({ directory: Instance.directory }, async () => {
          const token = (await githubToken()) ?? undefined
          const body = c.req.valid("json")
          await MobileGithubRepo.runGit(["checkout", "--", ...body.files], { cwd: Instance.directory, token })
          return c.json({ success: true as const })
        })
      },
    )
    .post(
      "/git/push",
      describeRoute({
        summary: "Push git branch for mobile",
        description: "Push the current branch to the remote.",
        operationId: "mobile.git.push",
        responses: {
          200: {
            description: "Branch pushed",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.literal(true), pushed: z.boolean() })),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("query", z.object({ upstream: z.string().optional() }).optional()),
      async (c) => {
        return withInstanceAsync({ directory: Instance.directory }, async () => {
          const token = (await githubToken()) ?? undefined
          const query = c.req.valid("query")
          const currentBranch = await MobileGithubRepo.runGit(["branch", "--show-current"], {
            cwd: Instance.directory,
            token,
          })
          const args = query?.upstream
            ? ["push", "--set-upstream", "origin", query.upstream]
            : ["push", "--set-upstream", "origin", currentBranch.trim()]

          try {
            await MobileGithubRepo.runGit(args, { cwd: Instance.directory, token })
            return c.json({ success: true as const, pushed: true })
          } catch {
            return c.json({ success: true as const, pushed: false })
          }
        })
      },
    )
    .post(
      "/git/pull",
      describeRoute({
        summary: "Pull git changes for mobile",
        description: "Pull remote changes into the current branch.",
        operationId: "mobile.git.pull",
        responses: {
          200: {
            description: "Changes pulled",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    success: z.literal(true),
                    pulled: z.boolean(),
                    conflicts: z.array(z.string()).optional(),
                  }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        return withInstanceAsync({ directory: Instance.directory }, async () => {
          const token = (await githubToken()) ?? undefined
          try {
            await MobileGithubRepo.runGit(["fetch", "origin"], { cwd: Instance.directory, token })
            await MobileGithubRepo.runGit(["pull", "--no-rebase"], { cwd: Instance.directory, token })
            return c.json({ success: true as const, pulled: true })
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            const hasConflicts = message.toLowerCase().includes("conflict")
            if (hasConflicts) {
              const statusOutput = await MobileGithubRepo.runGit(["status", "--porcelain"], {
                cwd: Instance.directory,
                token,
              })
              const conflicts = statusOutput
                .split("\n")
                .filter((line) => line.startsWith("UU") || line.startsWith("AA") || line.startsWith("DD"))
                .map((line) => line.slice(4))
              return c.json({ success: true as const, pulled: false, conflicts })
            }
            return c.json({ success: true as const, pulled: false })
          }
        })
      },
    )

function parseNumstat(output: string): Map<string, { additions: number; deletions: number }> {
  const stats = new Map<string, { additions: number; deletions: number }>()
  for (const line of output.split("\n")) {
    if (!line.trim()) continue
    const [additionsRaw, deletionsRaw, ...pathParts] = line.split("\t")
    const filePath = pathParts.join("\t").trim()
    if (!filePath) continue
    stats.set(filePath, {
      additions: additionsRaw === "-" ? 0 : Number.parseInt(additionsRaw, 10) || 0,
      deletions: deletionsRaw === "-" ? 0 : Number.parseInt(deletionsRaw, 10) || 0,
    })
  }
  return stats
}

function parseCommitStat(output: string): { filesCount: number; additions: number; deletions: number } {
  const stats = parseNumstat(output)
  let additions = 0
  let deletions = 0
  for (const stat of stats.values()) {
    additions += stat.additions
    deletions += stat.deletions
  }
  return { filesCount: stats.size, additions, deletions }
}

function parseFileDiffs(output: string): Array<{
  file: string
  oldPath?: string
  hunks: Array<{
    header: { oldStart: number; oldLines: number; newStart: number; newLines: number }
    lines: Array<{ type: "add" | "remove" | "context"; text: string; oldLineNumber?: number; newLineNumber?: number }>
  }>
  isBinary: boolean
  additions: number
  deletions: number
}> {
  const results: ReturnType<typeof parseFileDiffs> = []
  const fileBlocks = output
    .split(/(?=^diff --git )/m)
    .map((block) => block.trimEnd())
    .filter((block) => block.startsWith("diff --git "))

  for (const block of fileBlocks) {
    const headerMatch = block.match(/^diff --git a\/(.*) b\/(.*)$/m)
    if (!headerMatch) continue

    const [, oldPath, newPath] = headerMatch
    const file = newPath || oldPath
    const isRenamed = oldPath !== newPath && block.includes("rename from")

    if (block.includes("Binary files")) {
      results.push({
        file,
        oldPath: isRenamed ? oldPath : undefined,
        hunks: [],
        isBinary: true,
        additions: 0,
        deletions: 0,
      })
      continue
    }

    const hunks: ReturnType<typeof parseFileDiffs>[number]["hunks"] = []
    let additions = 0
    let deletions = 0

    let currentHunk: ReturnType<typeof parseFileDiffs>[number]["hunks"][number] | undefined
    let oldLine = 0
    let newLine = 0

    for (const line of block.split("\n")) {
      const hunkMatch = line.match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/)
      if (hunkMatch) {
        const [, oldStart, oldLinesStr, newStart, newLinesStr] = hunkMatch
        oldLine = Number.parseInt(oldStart, 10)
        newLine = Number.parseInt(newStart, 10)
        currentHunk = {
          header: {
            oldStart: oldLine,
            oldLines: Number.parseInt(oldLinesStr || "1", 10),
            newStart: newLine,
            newLines: Number.parseInt(newLinesStr || "1", 10),
          },
          lines: [],
        }
        hunks.push(currentHunk)
        continue
      }

      if (!currentHunk || line.startsWith("\\")) continue

      if (line.startsWith("+") && !line.startsWith("+++")) {
        currentHunk.lines.push({ type: "add", text: line.slice(1), newLineNumber: newLine++ })
        additions++
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        currentHunk.lines.push({ type: "remove", text: line.slice(1), oldLineNumber: oldLine++ })
        deletions++
      } else if (line.startsWith(" ")) {
        currentHunk.lines.push({
          type: "context",
          text: line.slice(1),
          oldLineNumber: oldLine++,
          newLineNumber: newLine++,
        })
      }
    }

    results.push({
      file,
      oldPath: isRenamed ? oldPath : undefined,
      hunks,
      isBinary: false,
      additions,
      deletions,
    })
  }

  return results
}
