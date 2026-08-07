import { Hono } from "hono"
import { stream } from "hono/streaming"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Session } from "../../session"
import { MessageV2 } from "../../session/message-v2"
import { SessionV2 } from "../../session/v2"
import { SessionEntry } from "../../session/v2/entry"
import { SessionEvent } from "../../session/v2/event"
import { SessionPrompt } from "../../session/prompt"
import { SessionContext } from "../../session/context-breakdown"
import { SessionCompaction } from "../../session/compaction"
import { SessionRevert } from "../../session/revert"
import { SessionStatus } from "@/session/status"
import { SessionGoal } from "@/session/goal"
import { SessionSummary } from "@/session/summary"
import { Todo } from "../../session/todo"
import { Agent } from "../../agent/agent"
import { Snapshot } from "@/snapshot"
import { Log } from "../../util/log"
import { PermissionNext } from "@/permission/next"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { SessionProxyMiddleware } from "../../workspace/session-proxy-middleware"
import { Filesystem } from "@/util/filesystem"
import { ShareNext } from "@/share/share-next"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { WorkspaceContext } from "@/workspace/workspace-context"
import { Delegation } from "@/delegation/manager"
import { Monitor } from "@/monitor/manager"
import { MCP } from "@/mcp"
import { Cause, Effect, Exit } from "effect"
import { locallyInstance, runPromiseWithLayer, withCurrentInstance, type InstanceContext } from "@/effect"

const log = Log.create({ service: "server" })

function runPermission<A, E>(effect: Effect.Effect<A, E, PermissionNext.Service>) {
  return runPromiseWithLayer(PermissionNext.defaultLayer, withCurrentInstance(effect))
}

function runStatus<A, E>(effect: Effect.Effect<A, E, SessionStatus.Service>) {
  return runPromiseWithLayer(SessionStatus.defaultLayer, withCurrentInstance(effect))
}

function runGoal<A, E>(effect: Effect.Effect<A, E, SessionGoal.Service>) {
  return runPromiseWithLayer(SessionGoal.defaultLayer, withCurrentInstance(effect))
}

function runTodo<A, E>(effect: Effect.Effect<A, E, Todo.Service>) {
  return runPromiseWithLayer(Todo.defaultLayer, withCurrentInstance(effect))
}

function runShareNext<A, E>(effect: Effect.Effect<A, E, ShareNext.Service>) {
  return runPromiseWithLayer(ShareNext.defaultLayer, effect)
}

function runSummary<A, E>(effect: Effect.Effect<A, E, SessionSummary.Service>) {
  return runPromiseWithLayer(SessionSummary.defaultLayer, withCurrentInstance(effect))
}

function runRevert<A, E>(effect: Effect.Effect<A, E, SessionRevert.Service>) {
  return runPromiseWithLayer(SessionRevert.defaultLayer, withCurrentInstance(effect))
}

function runCompaction<A, E>(effect: Effect.Effect<A, E, SessionCompaction.Service>) {
  return runPromiseWithLayer(SessionCompaction.defaultLayer, withCurrentInstance(effect))
}

function runConfig<A, E>(effect: Effect.Effect<A, E, Config.Service>) {
  return runPromiseWithLayer(Config.defaultLayer, withCurrentInstance(effect))
}

function runMCP<A, E>(effect: Effect.Effect<A, E, MCP.Service>) {
  return runPromiseWithLayer(MCP.defaultLayer, withCurrentInstance(effect))
}

function captureInstanceContext(): InstanceContext {
  return {
    directory: Instance.directory,
    worktree: Instance.worktree,
    project: Instance.project,
  }
}

function runSessionPrompt<A, E>(effect: Effect.Effect<A, E, SessionPrompt.Service>) {
  return runPromiseWithLayer(SessionPrompt.defaultLayer, withCurrentInstance(effect))
}

async function runSessionPromptAbort(effect: Effect.Effect<void, unknown, SessionPrompt.Service>) {
  const exit = await runPromiseWithLayer(SessionPrompt.defaultLayer, withCurrentInstance(Effect.exit(effect)))
  if (Exit.isSuccess(exit)) return
  if (Cause.hasInterruptsOnly(exit.cause)) return
  throw Cause.squash(exit.cause)
}

function runSessionPromptWithContext<A, E>(ctx: InstanceContext, effect: Effect.Effect<A, E, SessionPrompt.Service>) {
  return runPromiseWithLayer(SessionPrompt.defaultLayer, locallyInstance(ctx, effect))
}

function runSession<A, E>(effect: Effect.Effect<A, E, Session.Service>) {
  return runPromiseWithLayer(Session.defaultLayer, withCurrentInstance(effect))
}

function defaultAgent() {
  return runPromiseWithLayer(
    Agent.defaultLayer,
    withCurrentInstance(
      Effect.gen(function* () {
        const agent = yield* Agent.Service
        return yield* agent.defaultAgent()
      }),
    ),
  )
}

const BackgroundJobStatus = z.enum(["running", "synthesizing", "complete", "error", "timeout", "cancelled", "orphaned"])

const BackgroundJobSchema = z.object({
  jobID: z.string(),
  rootDelegationID: z.string(),
  parentSessionID: z.string(),
  title: z.string(),
  agent: z.string(),
  status: BackgroundJobStatus,
  source: z.string().optional(),
  workerSessionID: z.string().optional(),
  delegatorID: z.string().optional(),
  delegatorSessionID: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  completedAt: z.number().optional(),
  lastActivityAt: z.number().optional(),
  progressSummary: z.string().optional(),
  resultSummary: z.string().optional(),
  error: z.string().optional(),
})

export const SessionRoutes = lazy(() =>
  new Hono()
    .use(SessionProxyMiddleware)
    .get(
      "/",
      describeRoute({
        summary: "List sessions",
        description: "Get a list of all Nikcli sessions, sorted by most recently updated.",
        operationId: "session.list",
        responses: {
          200: {
            description: "List of sessions",
            content: {
              "application/json": {
                schema: resolver(Session.Info.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          directory: z.string().optional().meta({ description: "Filter sessions by project directory" }),
          roots: z.coerce.boolean().optional().meta({ description: "Only return root sessions (no parentID)" }),
          start: z.coerce.number().optional().meta({
            description: "Filter sessions updated on or after this timestamp (milliseconds since epoch)",
          }),
          search: z.string().optional().meta({
            description: "Filter sessions by title (case-insensitive)",
          }),
          limit: z.coerce.number().optional().meta({ description: "Maximum number of sessions to return" }),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const term = query.search?.toLowerCase()
        const directory = WorkspaceContext.workspaceID ? Instance.directory : query.directory
        const sessions = await runSession(
          Effect.gen(function* () {
            const service = yield* Session.Service
            const iterable = yield* service.list()
            return yield* Effect.promise(() => Array.fromAsync(iterable))
          }),
        )
        const filteredSessions: Session.Info[] = []
        for (const session of sessions) {
          // Opencode #22835: compare directories on a normalized path so a
          // query like `E:\Projects\foo` matches sessions stored as
          // `E:/Projects/foo` (Windows is happy to serve either form).
          if (directory !== undefined) {
            if (Filesystem.comparisonKey(session.directory) !== Filesystem.comparisonKey(directory)) continue
          }
          if (query.roots && session.parentID) continue
          if (query.start !== undefined && session.time.updated < query.start) continue
          if (term !== undefined && !session.title.toLowerCase().includes(term)) continue
          filteredSessions.push(session)
        }
        filteredSessions.sort((a, b) => b.time.updated - a.time.updated)
        if (query.limit !== undefined) return c.json(filteredSessions.slice(0, query.limit))
        return c.json(filteredSessions)
      },
    )
    .get(
      "/status",
      describeRoute({
        summary: "Get session status",
        description: "Retrieve the current status of all sessions, including active, idle, and completed states.",
        operationId: "session.status",
        responses: {
          200: {
            description: "Get session status",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), SessionStatus.Info)),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        const result = await runStatus(
          Effect.gen(function* () {
            const status = yield* SessionStatus.Service
            return yield* status.list()
          }),
        )
        return c.json(result)
      },
    )
    .get(
      "/:sessionID",
      describeRoute({
        summary: "Get session",
        description: "Retrieve detailed information about a specific Nikcli session.",
        tags: ["Session"],
        operationId: "session.get",
        responses: {
          200: {
            description: "Get session",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: Session.ID,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        log.info("SEARCH", { url: c.req.url })
        const session = await runSession(
          Effect.gen(function* () {
            const service = yield* Session.Service
            return yield* service.get(sessionID)
          }),
        )
        return c.json(session)
      },
    )
    .get(
      "/:sessionID/instructions",
      describeRoute({
        summary: "Get loaded instruction files",
        description:
          "Retrieve the list of instruction files that are currently loaded for this session (AGENTS.md, CLAUDE.md, etc.)",
        tags: ["Session"],
        operationId: "session.instructions",
        responses: {
          200: {
            description: "List of instruction files with their paths",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      path: z.string(),
                      name: z.string(),
                    }),
                  ),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: Session.ID,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        // Verify session exists first
        await runSession(
          Effect.gen(function* () {
            const service = yield* Session.Service
            yield* service.get(sessionID)
          }),
        )
        // Then get instruction paths using current instance context
        const ctx = captureInstanceContext()
        const config = await runConfig(
          Effect.gen(function* () {
            const service = yield* Config.Service
            return yield* service.get()
          }),
        )
        const { collectSystemPaths } = await import("../../session/instruction")
        const result = await collectSystemPaths(ctx, config)
        const instructions = Array.from(result.paths).map((p) => ({
          path: p,
          name: p.split("/").pop() || p,
        }))
        return c.json(instructions)
      },
    )
    .get(
      "/:sessionID/context",
      describeRoute({
        summary: "Get context usage breakdown",
        description:
          "Compute a per-source breakdown of estimated context tokens (system prompt, environment, instruction files, skills, MCP servers, built-in tools, agents, and conversation) along with the tokens last reported by the provider. Sources tagged togglable can be enabled/disabled to manage context.",
        tags: ["Session"],
        operationId: "session.context",
        responses: {
          200: {
            description: "Context usage breakdown",
            content: {
              "application/json": {
                schema: resolver(SessionContext.Breakdown),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: Session.ID,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const result = await SessionContext.breakdown(sessionID)
        return c.json(result)
      },
    )
    .post(
      "/:sessionID/context/toggle",
      describeRoute({
        summary: "Enable or disable a context source",
        description:
          "Enable or disable a single context source for this session. Supports MCP servers (kind=mcp), active skills (kind=skill), instruction files (kind=instruction), and tools (kind=tool). Returns the recomputed context breakdown.",
        tags: ["Session"],
        operationId: "session.contextToggle",
        responses: {
          200: {
            description: "Updated context usage breakdown",
            content: {
              "application/json": {
                schema: resolver(SessionContext.Breakdown),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: Session.ID })),
      validator(
        "json",
        z.object({
          kind: z.enum(["mcp", "skill", "instruction", "tool"]),
          key: z.string(),
          enabled: z.boolean(),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const { kind, key, enabled } = c.req.valid("json")

        if (kind === "mcp") {
          await runConfig(
            Effect.gen(function* () {
              const config = yield* Config.Service
              yield* config.update({ mcp: { [key]: { enabled } } })
            }),
          )
          await runMCP(
            Effect.gen(function* () {
              const mcp = yield* MCP.Service
              if (enabled) yield* mcp.connect(key)
              else yield* mcp.disconnect(key)
            }),
          ).catch((e) =>
            log.warn("mcp toggle connect/disconnect failed", {
              key,
              error: String(e),
            }),
          )
        } else if (kind === "skill") {
          await runSession(
            Effect.gen(function* () {
              const service = yield* Session.Service
              yield* service.update(sessionID, (draft) => {
                const set = new Set(draft.skills ?? [])
                if (enabled) set.add(key)
                else set.delete(key)
                draft.skills = [...set]
              })
            }),
          )
        } else if (kind === "tool") {
          await runSession(
            Effect.gen(function* () {
              const service = yield* Session.Service
              yield* service.update(sessionID, (draft) => {
                const map = { ...(draft.disabledTools ?? {}) }
                // `false`, not a deleted key: an opt-in tool
                // (`ToolRegistry.OPT_IN`) reads an absent entry as "never
                // asked for" and stays off, so enabling has to be recorded.
                map[key] = !enabled
                draft.disabledTools = map
              })
            }),
          )
        } else {
          await runSession(
            Effect.gen(function* () {
              const service = yield* Session.Service
              yield* service.update(sessionID, (draft) => {
                const set = new Set(draft.disabledInstructions ?? [])
                if (enabled) set.delete(key)
                else set.add(key)
                draft.disabledInstructions = [...set]
              })
            }),
          )
        }

        const result = await SessionContext.breakdown(sessionID)
        return c.json(result)
      },
    )
    .get(
      "/:sessionID/children",
      describeRoute({
        summary: "Get session children",
        tags: ["Session"],
        description: "Retrieve all child sessions that were forked from the specified parent session.",
        operationId: "session.children",
        responses: {
          200: {
            description: "List of children",
            content: {
              "application/json": {
                schema: resolver(Session.Info.array()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: Session.ID,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const session = await runSession(
          Effect.gen(function* () {
            const service = yield* Session.Service
            return yield* service.children(sessionID)
          }),
        )
        return c.json(session)
      },
    )
    .get(
      "/:sessionID/todo",
      describeRoute({
        summary: "Get session todos",
        description: "Retrieve the todo list associated with a specific session, showing tasks and action items.",
        operationId: "session.todo",
        responses: {
          200: {
            description: "Todo list",
            content: {
              "application/json": {
                schema: resolver(Todo.Info.array()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const todos = await runTodo(
          Effect.gen(function* () {
            const todo = yield* Todo.Service
            return yield* todo.get(sessionID)
          }),
        )
        return c.json(todos)
      },
    )
    .get(
      "/:sessionID/goal",
      describeRoute({
        summary: "Get session goal",
        description: "Retrieve the active goal state for a session, or null when no goal is set.",
        operationId: "session.goal",
        responses: {
          200: {
            description: "Goal state",
            content: {
              "application/json": {
                schema: resolver(SessionGoal.StateSchema.nullable()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const goal = await runGoal(
          Effect.gen(function* () {
            const service = yield* SessionGoal.Service
            return yield* service.get(sessionID)
          }),
        )
        return c.json(goal ?? null)
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Create session",
        description: "Create a new Nikcli session for interacting with AI assistants and managing conversations.",
        operationId: "session.create",
        responses: {
          ...errors(400),
          200: {
            description: "Successfully created session",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
        },
      }),
      validator("json", Session.CreateInput),
      async (c) => {
        try {
          const body = c.req.valid("json") ?? {}
          const session = await runSession(
            Effect.gen(function* () {
              const service = yield* Session.Service
              return yield* service.create(body)
            }),
          )
          return c.json(session)
        } catch (err) {
          log.error("session creation failed", {
            error: err instanceof Error ? err.message : String(err),
          })
          return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
        }
      },
    )
    .delete(
      "/:sessionID",
      describeRoute({
        summary: "Delete session",
        description: "Delete a session and permanently remove all associated data, including messages and history.",
        operationId: "session.delete",
        responses: {
          200: {
            description: "Successfully deleted session",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: Session.ID,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        await runSession(
          Effect.gen(function* () {
            const service = yield* Session.Service
            yield* service.remove(sessionID)
          }),
        )
        return c.json(true)
      },
    )
    .patch(
      "/:sessionID",
      describeRoute({
        summary: "Update session",
        description: "Update properties of an existing session, such as title or other metadata.",
        operationId: "session.update",
        responses: {
          200: {
            description: "Successfully updated session",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string(),
        }),
      ),
      validator(
        "json",
        z.object({
          title: z.string().optional(),
          time: z
            .object({
              archived: z.number().optional(),
            })
            .optional(),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const updates = c.req.valid("json")

        const updatedSession = await runSession(
          Effect.gen(function* () {
            const service = yield* Session.Service
            return yield* service.update(
              sessionID,
              (session) => {
                if (updates.title !== undefined) {
                  session.title = updates.title
                }
                if (updates.time?.archived !== undefined) session.time.archived = updates.time.archived
              },
              { touch: false },
            )
          }),
        )

        return c.json(updatedSession)
      },
    )
    .post(
      "/:sessionID/fork",
      describeRoute({
        summary: "Fork session",
        description: "Create a new session by forking an existing session at a specific message point.",
        operationId: "session.fork",
        responses: {
          200: {
            description: "200",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: Session.ForkInput.shape.sessionID,
        }),
      ),
      validator("json", Session.ForkInput.omit({ sessionID: true })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const result = await runSession(
          Effect.gen(function* () {
            const service = yield* Session.Service
            return yield* service.fork({ ...body, sessionID })
          }),
        )
        return c.json(result)
      },
    )
    .get(
      "/:sessionID/background",
      describeRoute({
        summary: "List background jobs",
        description: "List durable background jobs for a parent session.",
        operationId: "session.background",
        responses: {
          200: {
            description: "Background jobs",
            content: {
              "application/json": {
                schema: resolver(BackgroundJobSchema.array()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string(),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        // Validate session exists before exposing its background jobs
        const session = await runSession(
          Effect.gen(function* () {
            const service = yield* Session.Service
            return yield* service.get(sessionID)
          }),
        ).catch(() => undefined)
        if (!session) {
          return c.json({ error: "Session not found" }, 404)
        }
        return c.json(await Delegation.listJobs(sessionID))
      },
    )
    .get(
      "/:sessionID/background/:delegationID",
      describeRoute({
        summary: "Inspect background job",
        description: "Inspect a durable background job from a related session.",
        operationId: "session.background.inspect",
        responses: {
          200: {
            description: "Background job",
            content: {
              "application/json": {
                schema: resolver(BackgroundJobSchema.nullable()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string(),
          delegationID: z.string(),
        }),
      ),
      async (c) => {
        const { sessionID, delegationID } = c.req.valid("param")
        return c.json(await Delegation.inspectJobForSession(sessionID, delegationID))
      },
    )
    .get(
      "/:sessionID/background/:delegationID/read",
      describeRoute({
        summary: "Read background job output",
        description: "Read the synthesized output for a durable background job.",
        operationId: "session.background.read",
        responses: {
          200: {
            description: "Background job output",
            content: {
              "application/json": {
                schema: resolver(z.string()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string(),
          delegationID: z.string(),
        }),
      ),
      async (c) => {
        const { sessionID, delegationID } = c.req.valid("param")
        return c.json((await Delegation.readJobForSession(sessionID, delegationID)) ?? "")
      },
    )
    .post(
      "/:sessionID/background/:delegationID/cancel",
      describeRoute({
        summary: "Cancel background job",
        description: "Cancel a durable background job from a related session.",
        operationId: "session.background.cancel",
        responses: {
          200: {
            description: "Cancelled background job",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string(),
          delegationID: z.string(),
        }),
      ),
      async (c) => {
        const { sessionID, delegationID } = c.req.valid("param")
        return c.json(await Delegation.cancelJobForSession(sessionID, delegationID))
      },
    )
    .post(
      "/:sessionID/abort",
      describeRoute({
        summary: "Abort session",
        description: "Abort an active session and stop any ongoing AI processing or command execution.",
        operationId: "session.abort",
        responses: {
          200: {
            description: "Aborted session",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string(),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        await runSessionPromptAbort(
          Effect.gen(function* () {
            yield* Effect.promise(() => Delegation.cancelOwnedBySessionID(sessionID))
            yield* Effect.promise(() => Monitor.cancelAll(sessionID))
            const sessionPrompt = yield* SessionPrompt.Service
            yield* sessionPrompt.cancel(sessionID)
          }),
        )
        return c.json(true)
      },
    )
    .post(
      "/:sessionID/share",
      describeRoute({
        summary: "Share session",
        description: "Create a shareable link for a session, allowing others to view the conversation.",
        operationId: "session.share",
        responses: {
          200: {
            description: "Successfully shared session",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string(),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const config = await runConfig(
          Effect.gen(function* () {
            const service = yield* Config.Service
            return yield* service.get()
          }),
        )
        if (config.share === "disabled") {
          throw new Error("Sharing is disabled in configuration")
        }
        const origin = new URL(c.req.url).origin
        const share = await runShareNext(
          Effect.gen(function* () {
            const shareNext = yield* ShareNext.Service
            return yield* shareNext.create(
              sessionID,
              /^https?:\/\/nikcli\.local(?::\d+)?$/i.test(origin) ? undefined : { baseUrl: origin },
            )
          }),
        )
        const session = await runSession(
          Effect.gen(function* () {
            const service = yield* Session.Service
            yield* service.update(
              sessionID,
              (draft) => {
                draft.share = {
                  url: share.url,
                }
              },
              { touch: false },
            )
            return yield* service.get(sessionID)
          }),
        )
        return c.json(session)
      },
    )
    .get(
      "/:sessionID/diff",
      describeRoute({
        summary: "Get message diff",
        description: "Get the file changes (diff) that resulted from a specific user message in the session.",
        operationId: "session.diff",
        responses: {
          200: {
            description: "Successfully retrieved diff",
            content: {
              "application/json": {
                schema: resolver(Snapshot.FileDiff.array()),
              },
            },
          },
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionSummary.DiffInput.shape.sessionID,
        }),
      ),
      validator(
        "query",
        z.object({
          messageID: SessionSummary.DiffInput.shape.messageID,
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const params = c.req.valid("param")
        const result = await runSummary(
          Effect.gen(function* () {
            const summary = yield* SessionSummary.Service
            return yield* summary.diff({
              sessionID: params.sessionID,
              messageID: query.messageID,
            })
          }),
        )
        return c.json(result)
      },
    )
    .delete(
      "/:sessionID/share",
      describeRoute({
        summary: "Unshare session",
        description: "Remove the shareable link for a session, making it private again.",
        operationId: "session.unshare",
        responses: {
          200: {
            description: "Successfully unshared session",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: Session.ID,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const session = await runSession(
          Effect.gen(function* () {
            const service = yield* Session.Service
            yield* service.unshare(sessionID)
            return yield* service.get(sessionID)
          }),
        )
        return c.json(session)
      },
    )
    .post(
      "/:sessionID/summarize",
      describeRoute({
        summary: "Summarize session",
        description: "Generate a concise summary of the session using AI compaction to preserve key information.",
        operationId: "session.summarize",
        responses: {
          200: {
            description: "Summarized session",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
        }),
      ),
      validator(
        "json",
        z.object({
          providerID: z.string(),
          modelID: z.string(),
          auto: z.boolean().optional().default(false),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const { session, msgs } = await runSession(
          Effect.gen(function* () {
            const service = yield* Session.Service
            const session = yield* service.get(sessionID)
            const msgs = yield* service.messages({ sessionID })
            return { session, msgs }
          }),
        )
        await runRevert(
          Effect.gen(function* () {
            const revert = yield* SessionRevert.Service
            yield* revert.cleanup(session)
          }),
        )
        let currentAgent = await defaultAgent()
        for (let i = msgs.length - 1; i >= 0; i--) {
          const info = msgs[i].info
          if (info.role === "user") {
            currentAgent = info.agent || (await defaultAgent())
            break
          }
        }
        await runCompaction(
          Effect.gen(function* () {
            const compaction = yield* SessionCompaction.Service
            yield* compaction.create({
              sessionID,
              agent: currentAgent,
              model: {
                providerID: body.providerID,
                modelID: body.modelID,
              },
              auto: body.auto,
            })
          }),
        )
        await runSessionPrompt(
          Effect.gen(function* () {
            const sessionPrompt = yield* SessionPrompt.Service
            yield* sessionPrompt.loop(sessionID)
          }),
        )
        return c.json(true)
      },
    )
    .get(
      "/:sessionID/message",
      describeRoute({
        summary: "Get session messages",
        description: "Retrieve all messages in a session, including user prompts and AI responses.",
        operationId: "session.messages",
        responses: {
          200: {
            description: "List of messages",
            content: {
              "application/json": {
                schema: resolver(MessageV2.WithParts.array()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
        }),
      ),
      validator(
        "query",
        z.object({
          limit: z.coerce.number().optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const messages = await runSession(
          Effect.gen(function* () {
            const service = yield* Session.Service
            return yield* service.messages({
              sessionID: c.req.valid("param").sessionID,
              limit: query.limit,
            })
          }),
        )
        return c.json(messages)
      },
    )
    .get(
      "/:sessionID/message/:messageID",
      describeRoute({
        summary: "Get message",
        description: "Retrieve a specific message from a session by its message ID.",
        operationId: "session.message",
        responses: {
          200: {
            description: "Message",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    info: MessageV2.Info,
                    parts: MessageV2.Part.array(),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
          messageID: z.string().meta({ description: "Message ID" }),
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        await runSession(
          Effect.gen(function* () {
            const service = yield* Session.Service
            yield* service.get(params.sessionID)
          }),
        )
        const message = await MessageV2.get({
          sessionID: params.sessionID,
          messageID: params.messageID,
        })
        return c.json(message)
      },
    )
    .get(
      "/:sessionID/v2/entries",
      describeRoute({
        summary: "Get session v2 entries",
        description:
          "Retrieve the session as v2 entries: committed messages converted from storage plus the live in-flight assistant tail. Experimental — the v2 read model is documented in specs/v2/message-shape.md.",
        operationId: "session.v2.entries",
        responses: {
          200: {
            description: "List of v2 entries",
            content: {
              "application/json": {
                schema: resolver(SessionEntry.Entry.array()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        await runSession(
          Effect.gen(function* () {
            const service = yield* Session.Service
            yield* service.get(sessionID)
          }),
        )
        return c.json(await SessionV2.entries(sessionID))
      },
    )
    .get(
      "/:sessionID/v2/state",
      describeRoute({
        summary: "Get live session v2 state",
        description:
          "Retrieve the live v2 state for a session: `pending` holds the in-flight assistant work reduced by the v2 stepper. Entry-grade changes are announced on the bus as `session.v2.updated`. Experimental.",
        operationId: "session.v2.state",
        responses: {
          200: {
            description: "Live v2 state",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    entries: SessionEntry.Entry.array(),
                    pending: SessionEntry.Entry.array(),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        await runSession(
          Effect.gen(function* () {
            const service = yield* Session.Service
            yield* service.get(sessionID)
          }),
        )
        return c.json(SessionV2.state(sessionID))
      },
    )
    .get(
      "/:sessionID/v2/events",
      describeRoute({
        summary: "Get the persisted session v2 event log",
        description:
          "Retrieve the durable v2 event log for a session in replay order: step lifecycle events plus per-part coalesced updates. Replaying it through the v2 stepper reproduces the session reduction. Experimental.",
        operationId: "session.v2.events",
        responses: {
          200: {
            description: "List of persisted v2 events",
            content: {
              "application/json": {
                schema: resolver(SessionEvent.Event.array()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        await runSession(
          Effect.gen(function* () {
            const service = yield* Session.Service
            yield* service.get(sessionID)
          }),
        )
        return c.json(SessionV2.events(sessionID))
      },
    )
    .delete(
      "/:sessionID/message/:messageID/part/:partID",
      describeRoute({
        description: "Delete a part from a message",
        operationId: "part.delete",
        responses: {
          200: {
            description: "Successfully deleted part",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
          messageID: z.string().meta({ description: "Message ID" }),
          partID: z.string().meta({ description: "Part ID" }),
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        await runSession(
          Effect.gen(function* () {
            const service = yield* Session.Service
            yield* service.get(params.sessionID)
            yield* service.removePart({
              sessionID: params.sessionID,
              messageID: params.messageID,
              partID: params.partID,
            })
          }),
        )
        return c.json(true)
      },
    )
    .patch(
      "/:sessionID/message/:messageID/part/:partID",
      describeRoute({
        description: "Update a part in a message",
        operationId: "part.update",
        responses: {
          200: {
            description: "Successfully updated part",
            content: {
              "application/json": {
                schema: resolver(MessageV2.Part),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
          messageID: z.string().meta({ description: "Message ID" }),
          partID: z.string().meta({ description: "Part ID" }),
        }),
      ),
      validator("json", MessageV2.Part),
      async (c) => {
        const params = c.req.valid("param")
        const body = c.req.valid("json")
        await runSession(
          Effect.gen(function* () {
            const service = yield* Session.Service
            yield* service.get(params.sessionID)
          }),
        )
        if (body.id !== params.partID || body.messageID !== params.messageID || body.sessionID !== params.sessionID) {
          throw new Error(
            `Part mismatch: body.id='${body.id}' vs partID='${params.partID}', body.messageID='${body.messageID}' vs messageID='${params.messageID}', body.sessionID='${body.sessionID}' vs sessionID='${params.sessionID}'`,
          )
        }
        await MessageV2.get({
          sessionID: params.sessionID,
          messageID: params.messageID,
        })
        const part = await runSession(
          Effect.gen(function* () {
            const service = yield* Session.Service
            return yield* service.updatePart(body)
          }),
        )
        return c.json(part)
      },
    )
    .post(
      "/:sessionID/message",
      describeRoute({
        summary: "Send message",
        description: "Create and send a new message to a session, streaming the AI response.",
        operationId: "session.prompt",
        responses: {
          200: {
            description: "Created message",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    info: MessageV2.Assistant,
                    parts: MessageV2.Part.array(),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
        }),
      ),
      validator("json", SessionPrompt.PromptInput.omit({ sessionID: true })),
      async (c) => {
        c.status(200)
        c.header("Content-Type", "application/json")
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const ctx = captureInstanceContext()
        return stream(c, async (stream) => {
          const msg = await runSessionPromptWithContext(
            ctx,
            Effect.gen(function* () {
              const sessionPrompt = yield* SessionPrompt.Service
              return yield* sessionPrompt.prompt({ ...body, sessionID })
            }),
          )
          stream.write(JSON.stringify(msg))
        })
      },
    )
    .post(
      "/:sessionID/prompt_async",
      describeRoute({
        summary: "Send async message",
        description:
          "Create and send a new message to a session asynchronously. Persists the user message before returning 204, then runs the model loop in the background.",
        operationId: "session.prompt_async",
        responses: {
          204: {
            description: "Prompt accepted; user message is already persisted",
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
        }),
      ),
      validator("json", SessionPrompt.PromptInput.omit({ sessionID: true })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const ctx = captureInstanceContext()
        // Await admission so the user message is durable before the 204.
        // Only the model loop runs in the background.
        await runSessionPromptWithContext(
          ctx,
          Effect.gen(function* () {
            const sessionPrompt = yield* SessionPrompt.Service
            return yield* sessionPrompt.admit({ ...body, sessionID })
          }),
        )
        if (body.noReply !== true) {
          void runSessionPromptWithContext(
            ctx,
            Effect.gen(function* () {
              const sessionPrompt = yield* SessionPrompt.Service
              return yield* sessionPrompt.loop(sessionID)
            }),
          ).catch(() => undefined)
        }
        return c.body(null, 204)
      },
    )
    .post(
      "/:sessionID/command",
      describeRoute({
        summary: "Send command",
        description: "Send a new command to a session for execution by the AI assistant.",
        operationId: "session.command",
        responses: {
          200: {
            description: "Created message",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    info: MessageV2.Assistant,
                    parts: MessageV2.Part.array(),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
        }),
      ),
      validator("json", SessionPrompt.CommandInput.omit({ sessionID: true })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const msg = await runSessionPrompt(
          Effect.gen(function* () {
            const sessionPrompt = yield* SessionPrompt.Service
            return yield* sessionPrompt.command({ ...body, sessionID })
          }).pipe(
            // Translate the typed Session.BusyError at the route boundary so
            // the onError middleware stays a thin unknown-defect fallback.
            // The wire shape matches the legacy chain in server.ts:186-187
            // exactly so the SDK and existing API consumers see no change.
            // We use catchCause + isFailReason because the upstream effect
            // still types its error channel as `unknown`; once the
            // SessionPrompt service types are tightened (Phase A.2), this
            // becomes `Effect.catchTag("SessionBusyError", ...)`.
            Effect.catchCause((cause) => {
              const fail = cause.reasons.find(Cause.isFailReason)
              if (fail && fail.error instanceof Session.BusyError) {
                const err = fail.error
                return Effect.fail({
                  __http: {
                    status: 409,
                    name: err._tag,
                    data: { sessionID: err.sessionID, message: err.message },
                  },
                })
              }
              return Effect.failCause(cause)
            }),
          ),
        )
        return c.json(msg)
      },
    )
    .post(
      "/:sessionID/shell",
      describeRoute({
        summary: "Run shell command",
        description: "Execute a shell command within the session context and return the AI's response.",
        operationId: "session.shell",
        responses: {
          200: {
            description: "Created message",
            content: {
              "application/json": {
                // The handler returns `{ info, parts }` (SessionPrompt.shell); the spec
                // used to claim a bare AssistantMessage, which Unknown-typed clients
                // never caught. Keep the schema aligned with the real payload.
                schema: resolver(MessageV2.WithParts),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
        }),
      ),
      validator("json", SessionPrompt.ShellInput.omit({ sessionID: true })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const msg = await runSessionPrompt(
          Effect.gen(function* () {
            const sessionPrompt = yield* SessionPrompt.Service
            return yield* sessionPrompt.shell({ ...body, sessionID })
          }),
        )
        return c.json(msg)
      },
    )
    .post(
      "/:sessionID/revert",
      describeRoute({
        summary: "Revert message",
        description: "Revert a specific message in a session, undoing its effects and restoring the previous state.",
        operationId: "session.revert",
        responses: {
          200: {
            description: "Updated session",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string(),
        }),
      ),
      validator("json", SessionRevert.RevertInput.omit({ sessionID: true })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        log.info("revert", c.req.valid("json"))
        const session = await runRevert(
          Effect.gen(function* () {
            const revert = yield* SessionRevert.Service
            return yield* revert.revert({
              sessionID,
              ...c.req.valid("json"),
            })
          }),
        )
        return c.json(session)
      },
    )
    .post(
      "/:sessionID/unrevert",
      describeRoute({
        summary: "Restore reverted messages",
        description: "Restore all previously reverted messages in a session.",
        operationId: "session.unrevert",
        responses: {
          200: {
            description: "Updated session",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string(),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const session = await runRevert(
          Effect.gen(function* () {
            const revert = yield* SessionRevert.Service
            return yield* revert.unrevert({ sessionID })
          }),
        )
        return c.json(session)
      },
    )
    .post(
      "/:sessionID/permissions/:permissionID",
      describeRoute({
        summary: "Respond to permission",
        deprecated: true,
        description: "Approve or deny a permission request from the AI assistant.",
        operationId: "permission.respond",
        responses: {
          200: {
            description: "Permission processed successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string(),
          permissionID: z.string(),
        }),
      ),
      validator("json", z.object({ response: PermissionNext.Reply })),
      async (c) => {
        const params = c.req.valid("param")
        await runPermission(
          Effect.gen(function* () {
            const permission = yield* PermissionNext.Service
            yield* permission.reply({
              requestID: params.permissionID,
              reply: c.req.valid("json").response,
            })
          }),
        )
        return c.json(true)
      },
    )
    .get(
      "/:sessionID/monitor/:monitorID",
      describeRoute({
        summary: "Get session monitor",
        description: "Retrieve metadata for one background monitor attached to a session.",
        operationId: "session.monitor",
        responses: {
          200: {
            description: "Monitor metadata",
            content: {
              "application/json": {
                schema: resolver(z.unknown()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
          monitorID: z.string().meta({ description: "Monitor ID" }),
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        const { Monitor } = await import("@/monitor/manager")
        const record = await Monitor.get(params.sessionID, params.monitorID)
        return c.json(record)
      },
    )
    .get(
      "/:sessionID/monitor/:monitorID/log",
      describeRoute({
        summary: "Get session monitor log",
        description: "Read the latest output captured for a monitored background command.",
        operationId: "session.monitorLog",
        responses: {
          200: {
            description: "Monitor log snapshot",
            content: {
              "application/json": {
                schema: resolver(z.unknown()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
          monitorID: z.string().meta({ description: "Monitor ID" }),
        }),
      ),
      validator(
        "query",
        z.object({
          lines: z.coerce.number().optional().default(200).meta({ description: "Number of lines to return" }),
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        const query = c.req.valid("query")
        const { Monitor } = await import("@/monitor/manager")
        const snapshot = await Monitor.readLog(params.sessionID, params.monitorID, query.lines)
        return c.json(snapshot)
      },
    )
    .post(
      "/:sessionID/monitor/:monitorID/cancel",
      describeRoute({
        summary: "Cancel session monitor",
        description: "Stop a monitored background command attached to a session.",
        operationId: "session.monitorCancel",
        responses: {
          200: {
            description: "Cancelled monitor",
            content: {
              "application/json": {
                schema: resolver(z.unknown()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
          monitorID: z.string().meta({ description: "Monitor ID" }),
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        const { Monitor } = await import("@/monitor/manager")
        const record = await Monitor.cancel(params.sessionID, params.monitorID)
        return c.json(record)
      },
    ),
)
