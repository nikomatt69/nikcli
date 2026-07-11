import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Bus } from "@/bus"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionRepo } from "@/session/repo"
import { SessionPrompt } from "@/session/prompt"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { MessageV2 } from "@/session/message-v2"
import { PermissionNext } from "@/permission/next"
import { Question } from "@/question"
import { Snapshot } from "@/snapshot"
import { Command } from "@/command"
import { Workspace } from "@/workspace"
import { WorkspaceContext } from "@/workspace/workspace-context"
import { proxyWorkspaceRequest } from "@/workspace/session-proxy-middleware"
import { errors } from "../../error"
import { Effect } from "effect"
import { withInstanceAsync } from "@/effect"
import {
  log,
  runPermission,
  runQuestion,
  runCommandForSession,
  runStatus,
  runStatusForSession,
  runSessionPromptForSession,
  runSession,
  runSessionForSession,
  runSummary,
  MobileSessionSummary,
  MobileSessionDetail,
  MobileSessionCreateInput,
  MobileCommand,
  MobileSessionCommandInput,
  resolveMobilePromptDefaults,
  toHeadersObject,
  createExecutionWorkspace,
  statusForSession,
} from "./helpers"

export const SessionRoutes = () =>
  new Hono()
    .get(
      "/session",
      describeRoute({
        summary: "List mobile sessions",
        description: "Return mobile-friendly session summaries with current status.",
        operationId: "mobile.session.list",
        responses: {
          200: {
            description: "Sessions",
            content: {
              "application/json": {
                schema: resolver(MobileSessionSummary.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          limit: z.coerce.number().optional(),
          search: z.string().optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const term = query.search?.toLowerCase()
        const sessions: z.infer<typeof MobileSessionSummary>[] = []
        // List sessions across all projects for mobile (cross-project view).
        // Sessions live in the SQL store (see session/repo.ts) since the
        // database migration in 50b55f9a4 — the old `storageList(["session"])`
        // file-tree walk no longer finds them and would return an empty list.
        for (const session of SessionRepo.listAll()) {
          if (term) {
            const haystack = [
              session.title,
              session.github?.fullName,
              session.github?.baseBranch,
              session.github?.headBranch,
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
            if (!haystack.includes(term)) continue
          }
          try {
            sessions.push({
              info: session,
              status: await statusForSession(session),
            })
          } catch {
            // skip sessions whose status cannot be resolved (e.g. missing
            // instance directory); the next request will retry them.
          }
        }
        return c.json(query.limit ? sessions.slice(0, query.limit) : sessions)
      },
    )
    .post(
      "/session",
      describeRoute({
        summary: "Create mobile session",
        description: "Create a new session for the mobile app.",
        operationId: "mobile.session.create",
        responses: {
          200: {
            description: "Created session",
            content: { "application/json": { schema: resolver(Session.Info) } },
          },
          ...errors(400),
        },
      }),
      validator("json", MobileSessionCreateInput),
      async (c) => {
        const body = c.req.valid("json") as Record<string, unknown> | undefined
        const executionTarget = body?.executionTarget === "container" ? "container" : "local"
        let workspace: Workspace.Info | undefined
        const sessionInput = body
          ? {
              parentID: typeof body.parentID === "string" ? body.parentID : undefined,
              title: typeof body.title === "string" ? body.title : undefined,
              permission: body.permission as Session.Info["permission"],
              github: body.github as Session.Info["github"],
            }
          : undefined

        try {
          workspace = await createExecutionWorkspace({
            directory: Instance.directory,
            target: executionTarget,
          })
          const session = await WorkspaceContext.provide({
            workspaceID: workspace?.id,
            async fn() {
              return runSession(
                Effect.gen(function* () {
                  const service = yield* Session.Service
                  return yield* service.create(
                    workspace?.id
                      ? {
                          ...sessionInput,
                          workspaceID: workspace.id,
                        }
                      : sessionInput,
                  )
                }),
              )
            },
          })
          return c.json(session)
        } catch (error) {
          if (workspace) {
            await Workspace.remove(workspace.id).catch(() => undefined)
          }
          throw error
        }
      },
    )
    .get(
      "/session/:sessionID",
      describeRoute({
        summary: "Get mobile session detail",
        description: "Return a session, its messages, status, and pending permissions.",
        operationId: "mobile.session.detail",
        responses: {
          200: {
            description: "Session detail",
            content: {
              "application/json": { schema: resolver(MobileSessionDetail) },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const info = await runSession(
          Effect.gen(function* () {
            const service = yield* Session.Service
            return yield* service.getAnyProject(sessionID)
          }),
        )
        const { messages, permissions, questions, status } = await withInstanceAsync(
          { directory: info.directory },
          async () => {
            const [messages, permissions, questionItems] = await Promise.all([
              runSessionForSession(
                info,
                Effect.gen(function* () {
                  const service = yield* Session.Service
                  return yield* service.messages({ sessionID })
                }),
              ),
              runPermission(
                Effect.gen(function* () {
                  const permission = yield* PermissionNext.Service
                  const items = yield* permission.list()
                  return items.filter((item) => item.sessionID === sessionID)
                }),
              ),
              runQuestion(
                Effect.gen(function* () {
                  const question = yield* Question.Service
                  const items = yield* question.list()
                  return items.filter((item) => item.sessionID === sessionID)
                }),
              ),
            ])
            const status = await runStatus(
              Effect.gen(function* () {
                const sessionStatus = yield* SessionStatus.Service
                return yield* sessionStatus.get(sessionID)
              }),
            )
            return { messages, permissions, questions: questionItems, status }
          },
        )
        return c.json({
          info,
          status,
          messages,
          permissions,
          questions,
        })
      },
    )
    .get(
      "/session/:sessionID/diff/:messageID",
      describeRoute({
        summary: "Get session diff for mobile",
        description: "Return file diffs for a specific message in a session.",
        operationId: "mobile.session.diff",
        responses: {
          200: {
            description: "Message diff",
            content: {
              "application/json": {
                schema: resolver(Snapshot.FileDiff.array()),
              },
            },
          },
        },
      }),
      validator("param", z.object({ sessionID: z.string(), messageID: z.string() })),
      async (c) => {
        const params = c.req.valid("param")
        const session = await runSession(
          Effect.gen(function* () {
            const service = yield* Session.Service
            return yield* service.getAnyProject(params.sessionID)
          }),
        )
        const result = await withInstanceAsync({ directory: session.directory }, async () => {
          return runSummary(
            Effect.gen(function* () {
              const summary = yield* SessionSummary.Service
              return yield* summary.diff({
                sessionID: params.sessionID,
                messageID: params.messageID,
              })
            }),
          )
        })
        return c.json(result)
      },
    )
    .get(
      "/session/:sessionID/command",
      describeRoute({
        summary: "List session commands for mobile",
        description: "Return command metadata resolved in the current session context for mobile slash autocomplete.",
        operationId: "mobile.session.command.list",
        responses: {
          200: {
            description: "Commands",
            content: {
              "application/json": { schema: resolver(MobileCommand.array()) },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const session = await runSession(
          Effect.gen(function* () {
            const service = yield* Session.Service
            return yield* service.getAnyProject(sessionID)
          }),
        )
        if (session.workspaceID) {
          const response = await proxyWorkspaceRequest({
            workspaceID: session.workspaceID,
            method: "GET",
            url: "/command",
            signal: c.req.raw.signal,
          })

          if (response) {
            if (!response.ok) {
              return new Response(response.body, {
                status: response.status,
                headers: toHeadersObject(response.headers),
              })
            }

            const commands = (await response.json().catch(() => [])) as Array<Record<string, unknown>>
            return c.json(
              commands
                .map((command) => ({
                  name: typeof command.name === "string" ? command.name : "unknown",
                  description: typeof command.description === "string" ? command.description : undefined,
                  agent: typeof command.agent === "string" ? command.agent : undefined,
                  model: typeof command.model === "string" ? command.model : undefined,
                  mcp: typeof command.mcp === "boolean" ? command.mcp : undefined,
                  skill: typeof command.skill === "boolean" ? command.skill : undefined,
                  subtask: typeof command.subtask === "boolean" ? command.subtask : undefined,
                  hints: Array.isArray(command.hints)
                    ? command.hints.filter((hint): hint is string => typeof hint === "string")
                    : [],
                }))
                .filter((command) => command.name !== "unknown")
                .sort((a, b) => a.name.localeCompare(b.name)),
            )
          }
        }

        const commands = await runCommandForSession(
          session,
          Effect.gen(function* () {
            const command = yield* Command.Service
            return yield* command.list()
          }),
        )
        return c.json(
          commands
            .map((command) => ({
              name: command.name,
              description: command.description,
              agent: command.agent,
              model: command.model,
              mcp: command.mcp,
              skill: command.skill,
              subtask: command.subtask,
              hints: command.hints,
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        )
      },
    )
    .post(
      "/session/:sessionID/message",
      describeRoute({
        summary: "Send mobile session message",
        description: "Queue a message for a session and rely on the session stream for realtime updates.",
        operationId: "mobile.session.message",
        responses: {
          202: {
            description: "Message accepted",
            content: {
              "application/json": {
                schema: resolver(z.object({ accepted: z.literal(true) })),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      validator("json", SessionPrompt.PromptInput.omit({ sessionID: true })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const session = await runSession(
          Effect.gen(function* () {
            const service = yield* Session.Service
            return yield* service.getAnyProject(sessionID)
          }),
        )
        if (session.github?.worktree.cleanedAt) {
          return c.json({ error: "Session worktree has been cleaned up" }, 400)
        }

        const defaults = !body.agent || !body.model ? await resolveMobilePromptDefaults(session) : undefined
        const promptBody = {
          ...body,
          agent: body.agent ?? defaults?.agent,
          model: body.model ?? defaults?.model,
        }

        if (session.workspaceID) {
          const response = await proxyWorkspaceRequest({
            workspaceID: session.workspaceID,
            method: "POST",
            url: `/session/${encodeURIComponent(sessionID)}/prompt_async`,
            body: JSON.stringify(promptBody),
            headers: {
              "content-type": "application/json",
            },
            signal: c.req.raw.signal,
          })

          if (response) {
            if (!response.ok) {
              return new Response(response.body, {
                status: response.status,
                headers: toHeadersObject(response.headers),
              })
            }

            return c.json({ accepted: true as const }, 202)
          }
        }

        void runSessionPromptForSession(
          session,
          Effect.gen(function* () {
            const sessionPrompt = yield* SessionPrompt.Service
            return yield* sessionPrompt.prompt({
              ...promptBody,
              sessionID,
            })
          }),
        ).catch((error) => {
          void runStatusForSession(
            session,
            Effect.gen(function* () {
              const status = yield* SessionStatus.Service
              return yield* status.set(sessionID, { type: "idle" })
            }),
          ).catch(() => undefined)
          if (SessionPrompt.isUserInitiatedStop(error)) return
          const message = error instanceof Error ? error.message : String(error)
          void Bus.publish(Session.Event.Error, {
            sessionID,
            error: { name: "UnknownError" as const, data: { message } },
          }).catch(() => undefined)
          log.error("mobile session prompt failed", {
            sessionID,
            error: message,
          })
        })
        return c.json({ accepted: true as const }, 202)
      },
    )
    .post(
      "/session/:sessionID/command",
      describeRoute({
        summary: "Run mobile session command",
        description: "Execute a slash-style command against the current session.",
        operationId: "mobile.session.command",
        responses: {
          200: {
            description: "Command result",
            content: {
              "application/json": { schema: resolver(MessageV2.WithParts) },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      validator("json", MobileSessionCommandInput),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const session = await runSession(
          Effect.gen(function* () {
            const service = yield* Session.Service
            return yield* service.getAnyProject(sessionID)
          }),
        )
        if (session.github?.worktree.cleanedAt) {
          return c.json({ error: "Session worktree has been cleaned up" }, 400)
        }

        const commandBody = {
          command: body.command,
          arguments: body.arguments,
          agent: body.agent,
          model: body.model ? `${body.model.providerID}/${body.model.modelID}` : undefined,
          variant: body.variant,
        }

        if (session.workspaceID) {
          const response = await proxyWorkspaceRequest({
            workspaceID: session.workspaceID,
            method: "POST",
            url: `/session/${encodeURIComponent(sessionID)}/command`,
            body: JSON.stringify(commandBody),
            headers: {
              "content-type": "application/json",
            },
            signal: c.req.raw.signal,
          })

          if (response) {
            return new Response(response.body, {
              status: response.status,
              headers: toHeadersObject(response.headers),
            })
          }
        }

        const result = await runSessionPromptForSession(
          session,
          Effect.gen(function* () {
            const sessionPrompt = yield* SessionPrompt.Service
            return yield* sessionPrompt.command({
              ...commandBody,
              sessionID,
            })
          }),
        )

        return c.json(result)
      },
    )
    .post(
      "/session/:sessionID/abort",
      describeRoute({
        summary: "Abort mobile session",
        description: "Abort the active run for a session.",
        operationId: "mobile.session.abort",
        responses: {
          200: {
            description: "Session aborted",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.literal(true) })),
              },
            },
          },
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const session = await runSession(
          Effect.gen(function* () {
            const service = yield* Session.Service
            return yield* service.getAnyProject(sessionID)
          }),
        )
        if (session.workspaceID) {
          const response = await proxyWorkspaceRequest({
            workspaceID: session.workspaceID,
            method: "POST",
            url: `/session/${encodeURIComponent(sessionID)}/abort`,
            signal: c.req.raw.signal,
          })

          if (response) {
            if (!response.ok) {
              return new Response(response.body, {
                status: response.status,
                headers: toHeadersObject(response.headers),
              })
            }

            return c.json({ success: true as const })
          }
        }
        await runSessionPromptForSession(
          session,
          Effect.gen(function* () {
            const sessionPrompt = yield* SessionPrompt.Service
            yield* sessionPrompt.cancel(sessionID)
          }),
        )
        return c.json({ success: true as const })
      },
    )
    .delete(
      "/session/:sessionID",
      describeRoute({
        summary: "Delete mobile session",
        description: "Permanently delete a session and all associated data.",
        operationId: "mobile.session.delete",
        responses: {
          200: {
            description: "Session deleted",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.literal(true) })),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        await runSession(
          Effect.gen(function* () {
            const service = yield* Session.Service
            yield* service.remove(sessionID)
          }),
        )
        return c.json({ success: true as const })
      },
    )
    .post(
      "/session/:sessionID/permissions/:permissionID",
      describeRoute({
        summary: "Respond to permission from mobile",
        description: "Approve, always approve, or reject a pending permission request.",
        operationId: "mobile.permission.respond",
        responses: {
          200: {
            description: "Permission processed",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.literal(true) })),
              },
            },
          },
        },
      }),
      validator("param", z.object({ sessionID: z.string(), permissionID: z.string() })),
      validator("json", z.object({ response: PermissionNext.Reply })),
      async (c) => {
        const params = c.req.valid("param")
        const session = await runSession(
          Effect.gen(function* () {
            const service = yield* Session.Service
            return yield* service.getAnyProject(params.sessionID)
          }),
        )
        if (session.workspaceID) {
          const response = await proxyWorkspaceRequest({
            workspaceID: session.workspaceID,
            method: "POST",
            url: `/session/${encodeURIComponent(params.sessionID)}/permissions/${encodeURIComponent(params.permissionID)}`,
            body: JSON.stringify({ response: c.req.valid("json").response }),
            headers: {
              "content-type": "application/json",
            },
            signal: c.req.raw.signal,
          })

          if (response) {
            if (!response.ok) {
              return new Response(response.body, {
                status: response.status,
                headers: toHeadersObject(response.headers),
              })
            }

            return c.json({ success: true as const })
          }
        }
        await runPermission(
          Effect.gen(function* () {
            const permission = yield* PermissionNext.Service
            yield* permission.reply({
              requestID: params.permissionID,
              reply: c.req.valid("json").response,
            })
          }),
        )
        return c.json({ success: true as const })
      },
    )
    .post(
      "/session/:sessionID/question/:requestID",
      describeRoute({
        summary: "Respond to question from mobile",
        description: "Answer a pending question request.",
        operationId: "mobile.question.respond",
        responses: {
          200: {
            description: "Question answered",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.literal(true) })),
              },
            },
          },
        },
      }),
      validator("param", z.object({ sessionID: z.string(), requestID: z.string() })),
      validator("json", z.object({ answers: z.array(z.array(z.string())) })),
      async (c) => {
        const params = c.req.valid("param")
        const session = await runSession(
          Effect.gen(function* () {
            const service = yield* Session.Service
            return yield* service.getAnyProject(params.sessionID)
          }),
        )
        if (session.workspaceID) {
          const response = await proxyWorkspaceRequest({
            workspaceID: session.workspaceID,
            method: "POST",
            url: `/session/${encodeURIComponent(params.sessionID)}/question/${encodeURIComponent(params.requestID)}`,
            body: JSON.stringify({ answers: c.req.valid("json").answers }),
            headers: {
              "content-type": "application/json",
            },
            signal: c.req.raw.signal,
          })

          if (response) {
            if (!response.ok) {
              return new Response(response.body, {
                status: response.status,
                headers: toHeadersObject(response.headers),
              })
            }

            return c.json({ success: true as const })
          }
        }
        await runQuestion(
          Effect.gen(function* () {
            const question = yield* Question.Service
            yield* question.reply({
              requestID: params.requestID,
              answers: c.req.valid("json").answers,
            })
          }),
        )
        return c.json({ success: true as const })
      },
    )
    .delete(
      "/session/:sessionID/question/:requestID",
      describeRoute({
        summary: "Reject question from mobile",
        description: "Dismiss/reject a pending question request.",
        operationId: "mobile.question.reject",
        responses: {
          200: {
            description: "Question rejected",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.literal(true) })),
              },
            },
          },
        },
      }),
      validator("param", z.object({ sessionID: z.string(), requestID: z.string() })),
      async (c) => {
        const params = c.req.valid("param")
        const session = await runSession(
          Effect.gen(function* () {
            const service = yield* Session.Service
            return yield* service.getAnyProject(params.sessionID)
          }),
        )
        if (session.workspaceID) {
          const response = await proxyWorkspaceRequest({
            workspaceID: session.workspaceID,
            method: "DELETE",
            url: `/session/${encodeURIComponent(params.sessionID)}/question/${encodeURIComponent(params.requestID)}`,
            headers: {},
            signal: c.req.raw.signal,
          })

          if (response) {
            if (!response.ok) {
              return new Response(response.body, {
                status: response.status,
                headers: toHeadersObject(response.headers),
              })
            }

            return c.json({ success: true as const })
          }
        }
        await runQuestion(
          Effect.gen(function* () {
            const question = yield* Question.Service
            yield* question.reject(params.requestID)
          }),
        )
        return c.json({ success: true as const })
      },
    )
