import z from "zod"
import { Effect } from "effect"
import { GlobalBus } from "@/bus/global"
import { GithubApi } from "@/connectors/api/github"
import { withInstanceAsync } from "@/effect"
import { MobileGithubRepo } from "@/mobile/github-repo"
import { Session } from "@/session"
import { SessionStatus } from "@/session/status"
import { Worktree } from "@/worktree"
import { Workspace } from "@/workspace"
import {
  MobileGithubPublishInput,
  defaultPullRequestBody,
  extractSessionIDs,
  githubToken,
  runSession,
  runSessionForSession,
  runStatus,
  runWorktree,
} from "./helpers"
import { body, isResponse, json } from "./request"

const RenameInput = z.object({ title: z.string().min(1) })

function sessionEventStream(request: Request, sessionID: string): Response {
  let close: (() => void) | undefined
  const abort = () => close?.()
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      close?.()
    },
    start(controller) {
      const encoder = new TextEncoder()
      let closed = false
      const send = (data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch {
          close?.()
        }
      }
      send({ type: "server.connected", properties: { sessionID } })
      const onEvent = (event: { payload?: { type?: unknown; properties?: unknown } }) => {
        const payload = event?.payload
        if (!payload?.type) return
        const ids = extractSessionIDs(payload.properties)
        if (!ids.includes(sessionID)) return
        send(payload)
      }
      GlobalBus.on("event", onEvent)
      const heartbeat = setInterval(() => {
        send({ type: "server.heartbeat", properties: { sessionID } })
      }, 30_000)
      close = () => {
        if (closed) return
        closed = true
        clearInterval(heartbeat)
        GlobalBus.off("event", onEvent)
        request.signal.removeEventListener("abort", abort)
        try {
          controller.close()
        } catch {}
      }
      request.signal.addEventListener("abort", abort)
    },
  })
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  })
}

export async function handleSessionLifecycleRequest(request: Request): Promise<Response | undefined> {
  const path = new URL(request.url).pathname
  const publish = path.match(/^\/mobile\/session\/([^/]+)\/publish$/)
  if (publish && request.method === "POST") {
    const sessionID = decodeURIComponent(publish[1])
    const token = (await githubToken()) ?? undefined
    if (!token) return json({ error: "GitHub token not configured" }, 401)
    const input = await body(request, MobileGithubPublishInput)
    if (isResponse(input)) return input
    const bodyInput = input ?? {}

    const sessionInfo = await runSession(
      Effect.gen(function* () {
        const service = yield* Session.Service
        return yield* service.getAnyProject(sessionID)
      }),
    )
    if (!sessionInfo.github) return json({ error: "Session is not linked to GitHub" }, 400)
    if (sessionInfo.github.worktree.cleanedAt) return json({ error: "Session worktree has already been cleaned" }, 400)

    return withInstanceAsync({ directory: sessionInfo.directory }, async () => {
      const session = await runSession(
        Effect.gen(function* () {
          const service = yield* Session.Service
          return yield* service.get(sessionInfo.id)
        }),
      )
      const github = session.github
      if (!github) return json({ error: "Session is not linked to GitHub" }, 400)
      const status = await runStatus(
        Effect.gen(function* () {
          const sessionStatus = yield* SessionStatus.Service
          return yield* sessionStatus.get(session.id)
        }),
      )
      if (status.type !== "idle") {
        return json({ error: "Wait for the session to become idle before publishing" }, 400)
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
          ["commit", "-m", bodyInput.commitMessage?.trim() || session.title.trim() || `Update ${github.fullName}`],
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
        (await GithubApi.findPullRequestByHead(token, github.owner, github.repo, `${github.owner}:${github.headBranch}`)
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
              bodyInput.title?.trim() || session.title.trim() || `${github.fullName} changes`,
              github.headBranch,
              github.baseBranch,
              bodyInput.body?.trim() || defaultPullRequestBody(session),
            ).then((value) => ({
              number: value.number,
              url: value.html_url,
              title: value.title,
            }))
          : undefined)

      if (!pullRequest) {
        return json({ error: "Create changes in the worktree before publishing a pull request" }, 400)
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

      return json({
        commitSha: commitSha.trim(),
        branch: github.headBranch,
        pullRequest,
      })
    })
  }

  const cleanup = path.match(/^\/mobile\/session\/([^/]+)\/cleanup$/)
  if (cleanup && request.method === "POST") {
    const sessionID = decodeURIComponent(cleanup[1])
    const sessionInfo = await runSession(
      Effect.gen(function* () {
        const service = yield* Session.Service
        return yield* service.getAnyProject(sessionID)
      }),
    )
    const worktreeInfo = sessionInfo.github?.worktree ?? sessionInfo.worktree
    if (!worktreeInfo) return json({ error: "Session has no isolated worktree to clean up" }, 400)
    if (worktreeInfo.cleanedAt) return json({ success: true as const })

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
      return json({ error: "Wait for the session to become idle before cleaning up the worktree" }, 400)
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

    return json({ success: true as const })
  }

  const stream = path.match(/^\/mobile\/session\/([^/]+)\/stream$/)
  if (stream && request.method === "GET") {
    return sessionEventStream(request, decodeURIComponent(stream[1]))
  }

  const rename = path.match(/^\/mobile\/session\/([^/]+)\/rename$/)
  if (rename && request.method === "POST") {
    const sessionID = decodeURIComponent(rename[1])
    const input = await body(request, RenameInput)
    if (isResponse(input)) return input
    const session = await runSession(
      Effect.gen(function* () {
        const service = yield* Session.Service
        return yield* service.getAnyProject(sessionID)
      }),
    ).catch(() => undefined)
    if (!session) return json({ error: "not found" }, 404)
    await withInstanceAsync({ directory: session.directory }, async () => {
      await runSessionForSession(
        session,
        Effect.gen(function* () {
          const service = yield* Session.Service
          yield* service.update(sessionID, (draft) => {
            draft.title = input.title.trim()
          })
        }),
      )
    })
    return json({ success: true as const })
  }
}
