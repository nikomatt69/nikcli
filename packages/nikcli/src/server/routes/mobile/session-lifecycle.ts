import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { streamSSE } from "hono/streaming"
import z from "zod"
import { Session } from "@/session"
import { SessionStatus } from "@/session/status"
import { GlobalBus } from "@/bus/global"
import { Worktree } from "@/worktree"
import { GithubApi } from "@/connectors/api/github"
import { MobileGithubRepo } from "@/mobile/github-repo"
import { Workspace } from "@/workspace"
import { errors } from "../../error"
import { Effect } from "effect"
import { withInstanceAsync } from "@/effect"
import {
  log,
  runStatus,
  runSession,
  runSessionForSession,
  runWorktree,
  MobileGithubPublishInput,
  MobileGithubPublishResult,
  extractSessionIDs,
  githubToken,
  defaultPullRequestBody,
} from "./helpers"

export const SessionLifecycleRoutes = () =>
  new Hono()
    .post(
      "/session/:sessionID/publish",
      describeRoute({
        summary: "Publish GitHub session",
        description: "Commit the current worktree, push the session branch, and create or reuse a pull request.",
        operationId: "mobile.github.session.publish",
        responses: {
          200: {
            description: "Published pull request",
            content: { "application/json": { schema: resolver(MobileGithubPublishResult) } },
          },
          ...errors(400, 401, 404),
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      validator("json", MobileGithubPublishInput),
      async (c) => {
        const token = (await githubToken()) ?? undefined
        if (!token) return c.json({ error: "GitHub token not configured" }, 401)

        const body = c.req.valid("json") ?? {}
        const sessionInfo = await runSession(
          Effect.gen(function* () {
            const service = yield* Session.Service
            return yield* service.getAnyProject(c.req.valid("param").sessionID)
          }),
        )
        if (!sessionInfo.github) return c.json({ error: "Session is not linked to GitHub" }, 400)
        if (sessionInfo.github.worktree.cleanedAt)
          return c.json({ error: "Session worktree has already been cleaned" }, 400)

        return withInstanceAsync({ directory: sessionInfo.directory }, async () => {
          const session = await runSession(
            Effect.gen(function* () {
              const service = yield* Session.Service
              return yield* service.get(sessionInfo.id)
            }),
          )
          const github = session.github
          if (!github) return c.json({ error: "Session is not linked to GitHub" }, 400)
          const status = await runStatus(
            Effect.gen(function* () {
              const sessionStatus = yield* SessionStatus.Service
              return yield* sessionStatus.get(session.id)
            }),
          )
          if (status.type !== "idle") {
            return c.json({ error: "Wait for the session to become idle before publishing" }, 400)
          }

          await MobileGithubRepo.runGit(["fetch", "origin", github.baseBranch, "--prune"], {
            cwd: session.directory,
            token,
          })

          const dirty = await MobileGithubRepo.runGit(["status", "--porcelain"], {
            cwd: session.directory,
            token,
          })

          if (dirty.trim()) {
            await MobileGithubRepo.runGit(["add", "-A"], { cwd: session.directory, token })
            await MobileGithubRepo.runGit(
              ["commit", "-m", body.commitMessage?.trim() || session.title.trim() || `Update ${github.fullName}`],
              {
                cwd: session.directory,
                token,
              },
            )
          }

          await MobileGithubRepo.runGit(["push", "--set-upstream", "origin", github.headBranch], {
            cwd: session.directory,
            token,
          })

          const ahead = await MobileGithubRepo.runGit(
            ["rev-list", "--left-right", "--count", `origin/${github.baseBranch}...HEAD`],
            {
              cwd: session.directory,
              token,
            },
          )
          const [, aheadCountText = "0"] = ahead.trim().split(/\s+/)
          const aheadCount = Number.parseInt(aheadCountText, 10) || 0

          const commitSha = await MobileGithubRepo.runGit(["rev-parse", "HEAD"], {
            cwd: session.directory,
            token,
          })

          const existingPullRequest =
            github.pullRequest ||
            (await GithubApi.findPullRequestByHead(
              token,
              github.owner,
              github.repo,
              `${github.owner}:${github.headBranch}`,
            )
              .then((value) =>
                value
                  ? {
                      number: value.number,
                      url: value.html_url,
                      title: value.title,
                    }
                  : undefined,
              )
              .catch(() => undefined))

          const pullRequest =
            existingPullRequest ||
            (aheadCount > 0
              ? await GithubApi.createPullRequest(
                  token,
                  github.owner,
                  github.repo,
                  body.title?.trim() || session.title.trim() || `${github.fullName} changes`,
                  github.headBranch,
                  github.baseBranch,
                  body.body?.trim() || defaultPullRequestBody(session),
                ).then((value) => ({
                  number: value.number,
                  url: value.html_url,
                  title: value.title,
                }))
              : undefined)

          if (!pullRequest) {
            return c.json({ error: "Create changes in the worktree before publishing a pull request" }, 400)
          }

          await runSessionForSession(
            session,
            Effect.gen(function* () {
              const service = yield* Session.Service
              yield* service.update(session.id, (draft) => {
                if (!draft.github) return
                draft.github.pullRequest = pullRequest
                draft.github.lastCommitSha = commitSha.trim()
                draft.github.publishedAt = Date.now()
                draft.github.publishError = undefined
              })
            }),
          )

          return c.json({
            commitSha: commitSha.trim(),
            branch: github.headBranch,
            pullRequest,
          })
        })
      },
    )
    .post(
      "/session/:sessionID/cleanup",
      describeRoute({
        summary: "Cleanup session worktree",
        description: "Remove the isolated worktree created for a mobile session (GitHub-linked or plain).",
        operationId: "mobile.github.session.cleanup",
        responses: {
          200: {
            description: "Worktree cleaned",
            content: {
              "application/json": { schema: resolver(z.object({ success: z.literal(true) })) },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      async (c) => {
        const sessionInfo = await runSession(
          Effect.gen(function* () {
            const service = yield* Session.Service
            return yield* service.getAnyProject(c.req.valid("param").sessionID)
          }),
        )
        const worktreeInfo = sessionInfo.github?.worktree ?? sessionInfo.worktree
        if (!worktreeInfo) return c.json({ error: "Session has no isolated worktree to clean up" }, 400)
        if (worktreeInfo.cleanedAt) return c.json({ success: true as const })

        const repositoryDirectory =
          sessionInfo.github?.repositoryDirectory || worktreeInfo.repositoryDirectory || worktreeInfo.directory
        const idle = await withInstanceAsync({ directory: sessionInfo.directory }, async () => {
          const status = await runStatus(
            Effect.gen(function* () {
              const sessionStatus = yield* SessionStatus.Service
              return yield* sessionStatus.get(sessionInfo.id)
            }),
          )
          return status.type === "idle"
        })
        if (!idle) {
          return c.json({ error: "Wait for the session to become idle before cleaning up the worktree" }, 400)
        }

        await withInstanceAsync({ directory: repositoryDirectory }, async () => {
          if (sessionInfo.workspaceID) {
            await Workspace.remove(sessionInfo.workspaceID).catch(() => undefined)
          }
          await runWorktree(
            Effect.gen(function* () {
              const service = yield* Worktree.Service
              yield* service.remove({ directory: worktreeInfo.directory })
            }),
          )
        })

        await withInstanceAsync({ directory: repositoryDirectory }, async () => {
          await runSessionForSession(
            sessionInfo,
            Effect.gen(function* () {
              const service = yield* Session.Service
              yield* service.update(sessionInfo.id, (draft) => {
                if (draft.github) {
                  draft.github.worktree.cleanedAt = Date.now()
                  return
                }
                if (draft.worktree) draft.worktree.cleanedAt = Date.now()
              })
            }),
          )
        })

        return c.json({ success: true as const })
      },
    )
    .get(
      "/session/:sessionID/stream",
      describeRoute({
        summary: "Stream mobile session events",
        description: "Subscribe to session-scoped realtime events for the mobile chat UI.",
        operationId: "mobile.session.stream",
        responses: {
          200: {
            description: "Session event stream",
            content: { "text/event-stream": { schema: resolver(z.any()) } },
          },
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        return streamSSE(c, async (stream) => {
          await stream.writeSSE({
            data: JSON.stringify({ type: "server.connected", properties: { sessionID } }),
          })

          const onEvent = async (event: any) => {
            const payload = event?.payload
            if (!payload?.type) return
            const ids = extractSessionIDs(payload.properties)
            if (!ids.includes(sessionID)) return
            await stream.writeSSE({
              data: JSON.stringify(payload),
            })
          }

          GlobalBus.on("event", onEvent)

          const heartbeat = setInterval(() => {
            stream
              .writeSSE({
                data: JSON.stringify({ type: "server.heartbeat", properties: { sessionID } }),
              })
              .catch((error) => {
                log.debug("sse heartbeat failed", { sessionID, error })
              })
          }, 30000)

          await new Promise<void>((resolve) => {
            stream.onAbort(() => {
              clearInterval(heartbeat)
              GlobalBus.off("event", onEvent)
              resolve()
            })
          })
        })
      },
    )
    .post(
      "/session/:sessionID/rename",
      describeRoute({
        summary: "Rename a session",
        description: "Update the title of an existing session.",
        operationId: "mobile.session.rename",
        responses: {
          200: {
            description: "Session renamed",
            content: { "application/json": { schema: resolver(z.object({ success: z.literal(true) })) } },
          },
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      validator("json", z.object({ title: z.string().min(1) })),
      async (c) => {
        const { sessionID } = c.req.valid("param")
        const { title } = c.req.valid("json")
        const session = await runSession(
          Effect.gen(function* () {
            const service = yield* Session.Service
            return yield* service.getAnyProject(sessionID)
          }),
        ).catch(() => undefined)
        if (!session) return c.json({ error: "not found" }, 404)
        await withInstanceAsync({ directory: session.directory }, async () => {
          await runSessionForSession(
            session,
            Effect.gen(function* () {
              const service = yield* Session.Service
              yield* service.update(sessionID, (draft) => {
                draft.title = title.trim()
              })
            }),
          )
        })
        return c.json({ success: true as const })
      },
    )
