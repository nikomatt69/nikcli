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
import { SessionPending } from "@/session/pending"
import { SessionPrompt } from "@/session/prompt"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { Worktree } from "@/worktree"
import { Workspace } from "@/workspace"
import { WorkspaceContext } from "@/workspace/workspace-context"
import { proxyWorkspaceRequest } from "@/workspace/session-proxy-middleware"
import { TodoRepo } from "@/session/todo-repo"
import { MobileHttpError, proxyResponse } from "./request"
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

/** What the route accepted today: `SessionPrompt.PromptInput` minus the path-carried `sessionID`. */
export type SessionMessageInput = Omit<SessionPending.PromptInput, "sessionID">

export async function sessionList(query: { limit?: number; search?: string }) {
  const term = query.search?.toLowerCase(),
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
  return query.limit ? sessions.slice(0, query.limit) : sessions
}

export async function sessionCreate(input: typeof MobileSessionCreateInput._output) {
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
    return result
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

export async function sessionDetail(sessionID: string) {
  const info = await getSession(sessionID)
  return withInstanceAsync({ directory: info.directory }, async () => {
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
}

export async function sessionDiff(sessionID: string, messageID: string) {
  const info = await getSession(sessionID)
  return withInstanceAsync({ directory: info.directory }, () =>
    runSummary(
      Effect.gen(function* () {
        return yield* (yield* SessionSummary.Service).diff({ sessionID, messageID })
      }),
    ),
  )
}

export async function sessionCommandList(sessionID: string, signal?: AbortSignal) {
  const info = await getSession(sessionID)
  if (info.workspaceID) {
    const response = await proxyWorkspaceRequest({
      workspaceID: info.workspaceID,
      method: "GET",
      url: "/command",
      signal,
    })
    if (response) {
      if (!response.ok) return proxyResponse(response)
      const commands = (await response.json().catch(() => [])) as Array<Record<string, unknown>>
      return commands
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
        .sort((a, b) => a.name.localeCompare(b.name))
    }
  }
  const commands = await runCommandForSession(
    info,
    Effect.gen(function* () {
      return yield* (yield* Command.Service).list()
    }),
  )
  return commands
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
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function sessionMessage(sessionID: string, input: SessionMessageInput, signal?: AbortSignal) {
  const info = await getSession(sessionID)
  if (info.github?.worktree.cleanedAt) throw new MobileHttpError("Session worktree has been cleaned up", 400)
  const defaults = !input.agent || !input.model ? await resolveMobilePromptDefaults(info) : undefined
  const prompt = { ...input, agent: input.agent ?? defaults?.agent, model: input.model ?? defaults?.model }
  if (info.workspaceID) {
    const response = await proxyWorkspaceRequest({
      workspaceID: info.workspaceID,
      method: "POST",
      url: `/session/${encodeURIComponent(info.id)}/prompt_async`,
      body: JSON.stringify(prompt),
      headers: { "content-type": "application/json" },
      signal,
    })
    if (response) {
      if (!response.ok) return proxyResponse(response)
      return { accepted: true as const }
    }
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
  return { accepted: true as const }
}

export async function sessionCommand(
  sessionID: string,
  input: typeof MobileSessionCommandInput._output,
  signal?: AbortSignal,
) {
  const info = await getSession(sessionID)
  if (info.github?.worktree.cleanedAt) throw new MobileHttpError("Session worktree has been cleaned up", 400)
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
      signal,
    })
    if (response) return proxyResponse(response)
  }
  return runSessionPromptForSession(
    info,
    Effect.gen(function* () {
      return yield* (yield* SessionPrompt.Service).command({ ...payload, sessionID: info.id })
    }),
  )
}

export async function sessionAbort(sessionID: string, signal?: AbortSignal) {
  const info = await getSession(sessionID)
  if (info.workspaceID) {
    const response = await proxyWorkspaceRequest({
      workspaceID: info.workspaceID,
      method: "POST",
      url: `/session/${encodeURIComponent(info.id)}/abort`,
      signal,
    })
    if (response) {
      if (!response.ok) return proxyResponse(response)
      return { success: true as const }
    }
  }
  await runSessionPromptForSession(
    info,
    Effect.gen(function* () {
      yield* (yield* SessionPrompt.Service).cancel(info.id)
    }),
  )
  return { success: true as const }
}

export async function sessionDelete(sessionID: string) {
  const info = await getSession(sessionID).catch(() => undefined)
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
      yield* (yield* Session.Service).remove(sessionID)
    }),
  )
  return { success: true as const }
}

export async function permissionRespond(
  sessionID: string,
  permissionID: string,
  input: { response: PermissionNext.Reply },
  signal?: AbortSignal,
) {
  const info = await getSession(sessionID)
  if (info.workspaceID) {
    const response = await proxyWorkspaceRequest({
      workspaceID: info.workspaceID,
      method: "POST",
      url: `/session/${encodeURIComponent(info.id)}/permissions/${encodeURIComponent(permissionID)}`,
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
      signal,
    })
    if (response) {
      if (!response.ok) return proxyResponse(response)
      return { success: true as const }
    }
  }
  await runPermission(
    Effect.gen(function* () {
      yield* (yield* PermissionNext.Service).reply({ requestID: permissionID, reply: input.response })
    }),
  )
  return { success: true as const }
}

export async function questionRespond(sessionID: string, requestID: string, answers: string[][], signal?: AbortSignal) {
  return questionRoute(sessionID, requestID, answers, signal)
}

export async function questionReject(sessionID: string, requestID: string, signal?: AbortSignal) {
  return questionRoute(sessionID, requestID, undefined, signal)
}

async function questionRoute(
  sessionID: string,
  requestID: string,
  answers: string[][] | undefined,
  signal?: AbortSignal,
) {
  const info = await getSession(sessionID)
  if (info.workspaceID) {
    const response = await proxyWorkspaceRequest({
      workspaceID: info.workspaceID,
      method: answers ? "POST" : "DELETE",
      url: `/session/${encodeURIComponent(info.id)}/question/${encodeURIComponent(requestID)}`,
      body: answers ? JSON.stringify({ answers }) : undefined,
      headers: answers ? { "content-type": "application/json" } : {},
      signal,
    })
    if (response) {
      if (!response.ok) return proxyResponse(response)
      return { success: true as const }
    }
  }
  if (answers)
    await runQuestion(
      Effect.gen(function* () {
        yield* (yield* Question.Service).reply({ requestID, answers })
      }),
    )
  else
    await runQuestion(
      Effect.gen(function* () {
        yield* (yield* Question.Service).reject(requestID)
      }),
    )
  return { success: true as const }
}

export async function sessionTodo(sessionID: string) {
  await getSession(sessionID)
  return { todos: TodoRepo.get(sessionID) }
}
