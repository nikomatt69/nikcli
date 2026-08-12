import z from "zod"
import { Effect } from "effect"
import { Artifact } from "@/artifact"
import { Bus } from "@/bus"
import { Command } from "@/command"
import { withInstanceAsync } from "@/effect"
import { Instance } from "@/project/instance"
import { PermissionNext } from "@/permission/next"
import { Question } from "@/question"
import { Session } from "@/session"
import { SessionRepo } from "@/session/repo"
import { SessionPrompt } from "@/session/prompt"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { Worktree } from "@/worktree"
import { Workspace } from "@/workspace"
import { WorkspaceContext } from "@/workspace/workspace-context"
import { proxyWorkspaceRequest } from "@/workspace/session-proxy-middleware"
import { body, isResponse, json, proxyResponse, query } from "./request"
import {
  MobileSessionCommandInput,
  MobileSessionCreateInput,
  createExecutionWorkspace,
  createSessionWorktreeContext,
  log,
  resolveMobilePromptDefaults,
  runCommandForSession,
  runPermission,
  runQuestion,
  runSession,
  runSessionForSession,
  runSessionPromptForSession,
  runStatus,
  runStatusForSession,
  runSummary,
  runWorktree,
  runWorktreeForDirectory,
  statusForSession,
  toMobileArtifact,
} from "./helpers"

const getSession = (id: string) =>
  runSession(
    Effect.gen(function* () {
      return yield* (yield* Session.Service).getAnyProject(id)
    }),
  )
const match = (path: string, pattern: RegExp) => {
  const result = path.match(pattern)
  return result?.slice(1).map(decodeURIComponent)
}

export async function handleSessionRequest(request: Request): Promise<Response | undefined> {
  const path = new URL(request.url).pathname
  if (path === "/mobile/session" && request.method === "GET") {
    const q = query(request, z.object({ limit: z.coerce.number().optional(), search: z.string().optional() }))
    if (isResponse(q)) return q
    const term = q.search?.toLowerCase(),
      sessions = []
    for (const info of SessionRepo.listAll()) {
      const haystack = [info.title, info.github?.fullName, info.github?.baseBranch, info.github?.headBranch]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      if (term && !haystack.includes(term)) continue
      try {
        sessions.push({ info, status: await statusForSession(info) })
      } catch {}
    }
    return json(q.limit ? sessions.slice(0, q.limit) : sessions)
  }
  if (path === "/mobile/session" && request.method === "POST") {
    const input = await body(request, MobileSessionCreateInput)
    if (isResponse(input)) return input
    const target = input?.executionTarget === "container" ? "container" : "local",
      host = Instance.directory
    const sessionInput = input
      ? { parentID: input.parentID, title: input.title, permission: input.permission, github: input.github }
      : undefined
    const worktree = sessionInput?.github ? undefined : await createSessionWorktreeContext(host)
    const directory = worktree?.directory ?? host
    let workspace: Workspace.Info | undefined
    try {
      workspace = await createExecutionWorkspace({ directory, target })
      const result = await withInstanceAsync({ directory }, () =>
        WorkspaceContext.provide({
          workspaceID: workspace?.id,
          fn: () =>
            runSession(
              Effect.gen(function* () {
                return yield* (yield* Session.Service).create({
                  ...sessionInput,
                  github: sessionInput?.github ?? worktree?.github,
                  worktree: worktree?.worktree,
                  workspaceID: workspace?.id,
                })
              }),
            ),
        }),
      )
      return json(result)
    } catch (error) {
      if (workspace) await Workspace.remove(workspace.id).catch(() => undefined)
      if (worktree)
        await runWorktreeForDirectory(
          host,
          Effect.gen(function* () {
            yield* (yield* Worktree.Service).remove({ directory: worktree.directory })
          }),
        ).catch(() => undefined)
      throw error
    }
  }
  const detail = match(path, /^\/mobile\/session\/([^/]+)$/)
  if (detail && request.method === "GET") {
    const info = await getSession(detail[0])
    const result = await withInstanceAsync({ directory: info.directory }, async () => {
      const [messages, artifacts, permissions, questions] = await Promise.all([
        runSessionForSession(
          info,
          Effect.gen(function* () {
            return yield* (yield* Session.Service).messages({ sessionID: info.id })
          }),
        ),
        Artifact.list(info.id).then((items) => items.map(toMobileArtifact)),
        runPermission(
          Effect.gen(function* () {
            return (yield* (yield* PermissionNext.Service).list()).filter((item) => item.sessionID === info.id)
          }),
        ),
        runQuestion(
          Effect.gen(function* () {
            return (yield* (yield* Question.Service).list()).filter((item) => item.sessionID === info.id)
          }),
        ),
      ])
      const status = await runStatus(
        Effect.gen(function* () {
          return yield* (yield* SessionStatus.Service).get(info.id)
        }),
      )
      return { info, messages, artifacts, permissions, questions, status }
    })
    return json(result)
  }
  const diff = match(path, /^\/mobile\/session\/([^/]+)\/diff\/([^/]+)$/)
  if (diff && request.method === "GET") {
    const info = await getSession(diff[0])
    return json(
      await withInstanceAsync({ directory: info.directory }, () =>
        runSummary(
          Effect.gen(function* () {
            return yield* (yield* SessionSummary.Service).diff({ sessionID: diff[0], messageID: diff[1] })
          }),
        ),
      ),
    )
  }
  const command = match(path, /^\/mobile\/session\/([^/]+)\/command$/)
  if (command && request.method === "GET") {
    const info = await getSession(command[0])
    if (info.workspaceID) {
      const response = await proxyWorkspaceRequest({
        workspaceID: info.workspaceID,
        method: "GET",
        url: "/command",
        signal: request.signal,
      })
      if (response) {
        if (!response.ok) return proxyResponse(response)
        const commands = (await response.json().catch(() => [])) as Array<Record<string, unknown>>
        return json(
          commands
            .map((item) => ({
              name: typeof item.name === "string" ? item.name : "unknown",
              description: typeof item.description === "string" ? item.description : undefined,
              agent: typeof item.agent === "string" ? item.agent : undefined,
              model: typeof item.model === "string" ? item.model : undefined,
              mcp: typeof item.mcp === "boolean" ? item.mcp : undefined,
              skill: typeof item.skill === "boolean" ? item.skill : undefined,
              subtask: typeof item.subtask === "boolean" ? item.subtask : undefined,
              hints: Array.isArray(item.hints)
                ? item.hints.filter((value): value is string => typeof value === "string")
                : [],
            }))
            .filter((item) => item.name !== "unknown")
            .sort((a, b) => a.name.localeCompare(b.name)),
        )
      }
    }
    const commands = await runCommandForSession(
      info,
      Effect.gen(function* () {
        return yield* (yield* Command.Service).list()
      }),
    )
    return json(
      commands
        .map(({ name, description, agent, model, mcp, skill, subtask, hints }) => ({
          name,
          description,
          agent,
          model,
          mcp,
          skill,
          subtask,
          hints,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    )
  }
  const message = match(path, /^\/mobile\/session\/([^/]+)\/message$/)
  if (message && request.method === "POST") {
    const input = await body(request, SessionPrompt.PromptInput.omit({ sessionID: true }))
    if (isResponse(input)) return input
    const info = await getSession(message[0])
    if (info.github?.worktree.cleanedAt) return json({ error: "Session worktree has been cleaned up" }, 400)
    const defaults = !input.agent || !input.model ? await resolveMobilePromptDefaults(info) : undefined
    const prompt = { ...input, agent: input.agent ?? defaults?.agent, model: input.model ?? defaults?.model }
    if (info.workspaceID) {
      const response = await proxyWorkspaceRequest({
        workspaceID: info.workspaceID,
        method: "POST",
        url: `/session/${encodeURIComponent(info.id)}/prompt_async`,
        body: JSON.stringify(prompt),
        headers: { "content-type": "application/json" },
        signal: request.signal,
      })
      if (response) return response.ok ? json({ accepted: true }, 202) : proxyResponse(response)
    }
    void runSessionPromptForSession(
      info,
      Effect.gen(function* () {
        return yield* (yield* SessionPrompt.Service).prompt({ ...prompt, sessionID: info.id })
      }),
    ).catch((error) => {
      void runStatusForSession(
        info,
        Effect.gen(function* () {
          return yield* (yield* SessionStatus.Service).set(info.id, { type: "idle" })
        }),
      ).catch(() => undefined)
      if (SessionPrompt.isUserInitiatedStop(error)) return
      const text = error instanceof Error ? error.message : String(error)
      void Bus.publish(Session.Event.Error, {
        sessionID: info.id,
        error: { name: "UnknownError", data: { message: text } },
      }).catch(() => undefined)
      log.error("mobile session prompt failed", { sessionID: info.id, error: text })
    })
    return json({ accepted: true }, 202)
  }
  if (command && request.method === "POST") {
    const input = await body(request, MobileSessionCommandInput)
    if (isResponse(input)) return input
    const info = await getSession(command[0])
    if (info.github?.worktree.cleanedAt) return json({ error: "Session worktree has been cleaned up" }, 400)
    const payload = {
      command: input.command,
      arguments: input.arguments,
      agent: input.agent,
      model: input.model ? `${input.model.providerID}/${input.model.modelID}` : undefined,
      variant: input.variant,
    }
    if (info.workspaceID) {
      const response = await proxyWorkspaceRequest({
        workspaceID: info.workspaceID,
        method: "POST",
        url: `/session/${encodeURIComponent(info.id)}/command`,
        body: JSON.stringify(payload),
        headers: { "content-type": "application/json" },
        signal: request.signal,
      })
      if (response) return proxyResponse(response)
    }
    return json(
      await runSessionPromptForSession(
        info,
        Effect.gen(function* () {
          return yield* (yield* SessionPrompt.Service).command({ ...payload, sessionID: info.id })
        }),
      ),
    )
  }
  const abort = match(path, /^\/mobile\/session\/([^/]+)\/abort$/)
  if (abort && request.method === "POST") {
    const info = await getSession(abort[0])
    if (info.workspaceID) {
      const response = await proxyWorkspaceRequest({
        workspaceID: info.workspaceID,
        method: "POST",
        url: `/session/${encodeURIComponent(info.id)}/abort`,
        signal: request.signal,
      })
      if (response) return response.ok ? json({ success: true }) : proxyResponse(response)
    }
    await runSessionPromptForSession(
      info,
      Effect.gen(function* () {
        yield* (yield* SessionPrompt.Service).cancel(info.id)
      }),
    )
    return json({ success: true })
  }
  if (detail && request.method === "DELETE") {
    const info = await getSession(detail[0]).catch(() => undefined)
    const worktree = info?.github?.worktree ?? info?.worktree
    if (info && worktree && !worktree.cleanedAt) {
      const repo = info.github?.repositoryDirectory || worktree.repositoryDirectory || worktree.directory
      await withInstanceAsync({ directory: repo }, async () => {
        if (info.workspaceID) await Workspace.remove(info.workspaceID).catch(() => undefined)
        await runWorktree(
          Effect.gen(function* () {
            yield* (yield* Worktree.Service).remove({ directory: worktree.directory })
          }),
        )
      }).catch(() => undefined)
    }
    await runSession(
      Effect.gen(function* () {
        yield* (yield* Session.Service).remove(detail[0])
      }),
    )
    return json({ success: true })
  }
  const permission = match(path, /^\/mobile\/session\/([^/]+)\/permissions\/([^/]+)$/)
  if (permission && request.method === "POST") {
    const input = await body(request, z.object({ response: PermissionNext.Reply }))
    if (isResponse(input)) return input
    const info = await getSession(permission[0])
    if (info.workspaceID) {
      const response = await proxyWorkspaceRequest({
        workspaceID: info.workspaceID,
        method: "POST",
        url: `/session/${encodeURIComponent(info.id)}/permissions/${encodeURIComponent(permission[1])}`,
        body: JSON.stringify(input),
        headers: { "content-type": "application/json" },
        signal: request.signal,
      })
      if (response) return response.ok ? json({ success: true }) : proxyResponse(response)
    }
    await runPermission(
      Effect.gen(function* () {
        yield* (yield* PermissionNext.Service).reply({ requestID: permission[1], reply: input.response })
      }),
    )
    return json({ success: true })
  }
  const question = match(path, /^\/mobile\/session\/([^/]+)\/question\/([^/]+)$/)
  if (question && (request.method === "POST" || request.method === "DELETE")) {
    const info = await getSession(question[0])
    let answers: string[][] | undefined
    if (request.method === "POST") {
      const input = await body(request, z.object({ answers: z.array(z.array(z.string())) }))
      if (isResponse(input)) return input
      answers = input.answers
    }
    if (info.workspaceID) {
      const response = await proxyWorkspaceRequest({
        workspaceID: info.workspaceID,
        method: request.method,
        url: `/session/${encodeURIComponent(info.id)}/question/${encodeURIComponent(question[1])}`,
        body: answers ? JSON.stringify({ answers }) : undefined,
        headers: answers ? { "content-type": "application/json" } : {},
        signal: request.signal,
      })
      if (response) return response.ok ? json({ success: true }) : proxyResponse(response)
    }
    if (answers)
      await runQuestion(
        Effect.gen(function* () {
          yield* (yield* Question.Service).reply({ requestID: question[1], answers })
        }),
      )
    else
      await runQuestion(
        Effect.gen(function* () {
          yield* (yield* Question.Service).reject(question[1])
        }),
      )
    return json({ success: true })
  }
}
