import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { Cause, Effect, Layer, Schema, SchemaGetter } from "effect"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { Delegation } from "@/delegation/manager"
import { InstanceState } from "@/effect"
import { Log } from "@/util/log"
import { MCP } from "@/mcp"
import { Monitor } from "@/monitor/manager"
import { PermissionNext } from "@/permission/next"
import { Session } from "@/session"
import { SessionContext } from "@/session/context-breakdown"
import { SessionGoal } from "@/session/goal"
import { ShareNext } from "@/share/share-next"
import { Snapshot } from "@/snapshot"
import { SessionError } from "@/session/error"
import { MessageV2 } from "@/session/message-v2"
import { SessionCompaction } from "@/session/compaction"
import { SessionPrompt } from "@/session/prompt"
import { SessionPending } from "@/session/pending"
import { SessionRevert } from "@/session/revert"
import { SessionSummary } from "@/session/summary"
import { SessionStatus } from "@/session/status"
import { Todo } from "@/session/todo"
import { SessionV2 } from "@/session/v2"
import { WorkspaceContext } from "@/workspace/workspace-context"
import { Filesystem } from "@/util/filesystem"

export namespace SessionHttpApi {
  const log = Log.create({ service: "httpapi.session" })

  const BooleanFromString = Schema.String.pipe(
    Schema.decodeTo(Schema.Boolean, {
      decode: SchemaGetter.transform((value: string) => value === "true"),
      encode: SchemaGetter.transform((value: boolean) => String(value)),
    }),
  )

  const ListQuery = Schema.Struct({
    directory: Schema.optional(Schema.String),
    roots: Schema.optional(BooleanFromString),
    start: Schema.optional(Schema.NumberFromString),
    search: Schema.optional(Schema.String),
    limit: Schema.optional(Schema.NumberFromString),
  })
  const MessagesQuery = Schema.Struct({
    limit: Schema.optional(Schema.NumberFromString),
  })
  const DiffQuery = Schema.Struct({
    messageID: Schema.optional(Schema.String),
  })
  const CreatePayload = Schema.Struct({
    parentID: Schema.optional(Schema.String),
    title: Schema.optional(Schema.String),
    permission: Schema.optional(Schema.Array(Schema.Unknown)),
    skills: Schema.optional(Schema.Array(Schema.String)),
    github: Schema.optional(Schema.Unknown),
    workspaceID: Schema.optional(Schema.String),
  }).annotate({ identifier: "SessionCreateInput" })
  const UpdatePayload = Schema.Struct({
    title: Schema.optional(Schema.String),
    time: Schema.optional(
      Schema.Struct({
        archived: Schema.optional(Schema.Number),
      }),
    ),
  }).annotate({ identifier: "SessionUpdateInput" })
  const ForkPayload = Schema.Struct({
    messageID: Schema.optional(Schema.String),
  }).annotate({ identifier: "SessionForkInput" })
  const RevertPayload = Schema.Struct({
    messageID: Schema.String,
    partID: Schema.optional(Schema.String),
  }).annotate({ identifier: "SessionRevertInput" })
  const SummarizePayload = Schema.Struct({
    providerID: Schema.String,
    modelID: Schema.String,
    auto: Schema.optional(Schema.Boolean),
  }).annotate({ identifier: "SessionSummarizeInput" })
  const CommandPayload = Schema.Struct({
    messageID: Schema.optional(Schema.String),
    delivery: Schema.optional(Schema.Literals(["steer", "queue"])),
    agent: Schema.optional(Schema.String),
    model: Schema.optional(Schema.String),
    arguments: Schema.String,
    command: Schema.String,
    variant: Schema.optional(Schema.String),
    parts: Schema.optional(Schema.Array(Schema.Unknown)),
  }).annotate({ identifier: "SessionCommandInput" })
  const ShellPayload = Schema.Struct({
    agent: Schema.String,
    model: Schema.optional(
      Schema.Struct({
        providerID: Schema.String,
        modelID: Schema.String,
      }),
    ),
    command: Schema.String,
  }).annotate({ identifier: "SessionShellInput" })
  const PermissionRespondPath = Schema.Struct({
    sessionID: Schema.String,
    permissionID: Schema.String,
  })
  const PermissionRespondPayload = Schema.Struct({
    response: Schema.Literals(["once", "always", "reject"]),
  }).annotate({ identifier: "SessionPermissionRespondInput" })

  // Named domain schemas so the Effect OpenAPI/SDK surface emits the same
  // components as Hono (`Session`, `SessionStatus`, `Todo`, `Message`, …).
  const SessionList = Schema.Array(Session.InfoSchema).annotate({
    identifier: "SessionList",
  })
  const MessageList = Schema.Array(MessageV2.WithPartsSchema).annotate({
    identifier: "MessageList",
  })
  const PendingList = Schema.Array(SessionPending.InfoSchema).annotate({
    identifier: "SessionPendingInputList",
  })
  const FileDiffList = Schema.Array(Snapshot.FileDiffSchema).annotate({
    identifier: "FileDiffList",
  })
  const SessionInfo = Session.InfoSchema
  const SessionStatusMap = Schema.Record(Schema.String, SessionStatus.InfoSchema).annotate({
    identifier: "SessionStatusMap",
  })
  const TodoList = Schema.Array(Todo.InfoSchema).annotate({
    identifier: "TodoList",
  })
  const BooleanResult = Schema.Boolean.annotate({
    identifier: "BooleanResult",
  })
  const SessionIDPath = Schema.Struct({
    sessionID: Schema.String,
  })
  const PendingPath = Schema.Struct({
    sessionID: Schema.String,
    pendingID: Schema.String,
  })
  const MessagePath = Schema.Struct({
    sessionID: Schema.String,
    messageID: Schema.String,
  })
  const PartPath = Schema.Struct({
    sessionID: Schema.String,
    messageID: Schema.String,
    partID: Schema.String,
  })
  const MessageWithParts = MessageV2.WithPartsSchema.annotate({
    identifier: "MessageWithParts",
  })
  const MessagePart = MessageV2.PartSchema
  /**
   * Mirrors `SessionContext.Breakdown`, `SessionGoal.StateEffect`,
   * `Delegation.JobItem` and the monitor records. Declared here so the
   * generated clients carry real types; these endpoints encode their
   * responses through the Effect handlers, so the shapes must match what the
   * services return after `jsonSafe` drops `undefined` properties.
   */
  const ContextSource = Schema.Struct({
    id: Schema.String,
    category: Schema.Literals(["system", "instructions", "skills", "mcp", "tools", "agents", "messages"]),
    label: Schema.String,
    detail: Schema.optional(Schema.String),
    tokens: Schema.Number,
    enabled: Schema.Boolean,
    togglable: Schema.Boolean,
    toggleKind: Schema.optional(Schema.Literals(["mcp", "skill", "instruction", "tool"])),
    toggleKey: Schema.optional(Schema.String),
  }).annotate({ identifier: "SessionContextSource" })

  const ContextBreakdown = Schema.Struct({
    model: Schema.optional(
      Schema.Struct({
        providerID: Schema.String,
        modelID: Schema.String,
        name: Schema.String,
        contextLimit: Schema.Number,
      }),
    ),
    reported: Schema.Struct({
      input: Schema.Number,
      output: Schema.Number,
      reasoning: Schema.Number,
      cacheRead: Schema.Number,
      cacheWrite: Schema.Number,
      total: Schema.Number,
    }),
    sources: Schema.Array(ContextSource),
    estimatedTotal: Schema.Number,
  }).annotate({ identifier: "SessionContextBreakdown" })

  /** `null` when the session has no goal. */
  const GoalOutput = Schema.NullOr(SessionGoal.StateEffect).annotate({
    identifier: "SessionGoalOutput",
  })

  const DelegationJob = Schema.Struct({
    jobID: Schema.String,
    rootDelegationID: Schema.String,
    parentSessionID: Schema.String,
    title: Schema.String,
    agent: Schema.String,
    parentAgent: Schema.optional(Schema.String),
    status: Schema.Literals(["running", "complete", "error", "timeout", "cancelled", "orphaned", "synthesizing"]),
    source: Schema.optional(
      Schema.Literals([
        "task",
        "model-subtask",
        "advisor",
        "research",
        "ultrareview",
        "delegator",
        "delegator-followup",
        "loop",
        "other",
      ]),
    ),
    workerSessionID: Schema.optional(Schema.String),
    delegatorID: Schema.optional(Schema.String),
    delegatorSessionID: Schema.optional(Schema.String),
    createdAt: Schema.Number,
    updatedAt: Schema.Number,
    completedAt: Schema.optional(Schema.Number),
    lastActivityAt: Schema.optional(Schema.Number),
    progressSummary: Schema.optional(Schema.String),
    resultSummary: Schema.optional(Schema.String),
    error: Schema.optional(Schema.String),
  }).annotate({ identifier: "DelegationJob" })

  const BackgroundOutput = Schema.Array(DelegationJob).annotate({
    identifier: "SessionBackgroundOutput",
  })
  /** `null` when the delegation is unknown or not visible to the session. */
  const BackgroundInspectOutput = Schema.NullOr(DelegationJob).annotate({
    identifier: "SessionBackgroundInspectOutput",
  })

  /** `null` when the monitor is unknown. */
  const MonitorOutput = Schema.NullOr(Monitor.RecordSchema).annotate({
    identifier: "SessionMonitorOutput",
  })
  const MonitorLogOutput = Schema.NullOr(Monitor.LogSnapshotSchema).annotate({
    identifier: "SessionMonitorLogOutput",
  })

  const SessionV2EntryList = Schema.Array(Schema.Unknown).annotate({
    identifier: "SessionV2EntryList",
  })
  const SessionV2State = Schema.Unknown.annotate({
    identifier: "SessionV2State",
  })
  const SessionV2EventList = Schema.Array(Schema.Unknown).annotate({
    identifier: "SessionV2EventList",
  })

  /**
   * Declared error contracts, mirroring the legacy Hono `{ name, data }`
   * bodies byte-for-byte. `name` is a literal so the response encoder can
   * discriminate union members (404 vs 409) by value instead of falling
   * back to declaration order.
   */
  const NotFound = Schema.Struct({
    name: Schema.Literal("NotFoundError"),
    data: Schema.Record(Schema.String, Schema.Unknown),
  }).annotate({ identifier: "SessionNotFoundError", httpApiStatus: 404 })
  /** The background list route returns a bare `{ error }` 404, unlike the
   * `{ name, data }` shape used everywhere else — preserved for parity. */
  const BackgroundNotFound = Schema.Struct({
    error: Schema.Literal("Session not found"),
  }).annotate({ identifier: "SessionBackgroundNotFound", httpApiStatus: 404 })
  const Busy = Schema.Struct({
    name: Schema.Literal("SessionBusyError"),
    data: Schema.Record(Schema.String, Schema.Unknown),
  }).annotate({ identifier: "SessionBusyErrorBody", httpApiStatus: 409 })

  type DeclaredError = typeof NotFound.Type | typeof Busy.Type

  /** Expected boundary failures → declared errors; everything else is a defect. */
  function asSessionError(cause: unknown): Effect.Effect<never, DeclaredError> {
    if (SessionError.isNotFound(cause)) {
      return Effect.fail({
        name: "NotFoundError" as const,
        data: { message: cause.message } as Record<string, unknown>,
      })
    }
    if (cause instanceof Session.BusyError) {
      return Effect.fail({
        name: "SessionBusyError" as const,
        data: { sessionID: cause.sessionID, message: cause.message } as Record<string, unknown>,
      })
    }
    return Effect.die(cause)
  }

  /** Failure first, defect second — services still wrap async impls with
   * Effect.promise, so expected errors can arrive on either channel. */
  const declaredErrors = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(Effect.catch(asSessionError), Effect.catchDefect(asSessionError))

  // Session/message objects often carry `undefined` properties (parentID, workspaceID, ...).
  // Effect HttpApi rejects those when encoding `Schema.Unknown` because `undefined` is not a
  // valid JSON value. Round-tripping through JSON.stringify normalizes the payload by
  // dropping undefined keys without changing the schema contract for callers.
  // Returning `T` keeps handler signatures inferable for HttpApi.
  const jsonSafe = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T

  const InstructionList = Schema.Array(Schema.Struct({ path: Schema.String, name: Schema.String })).annotate({
    identifier: "SessionInstructionList",
  })

  const ContextTogglePayload = Schema.Struct({
    kind: Schema.Literals(["mcp", "skill", "instruction", "tool"]),
    key: Schema.String,
    enabled: Schema.Boolean,
  }).annotate({ identifier: "SessionContextToggleInput" })

  const DelegationPath = Schema.Struct({
    sessionID: Schema.String,
    delegationID: Schema.String,
  })

  const MonitorPath = Schema.Struct({
    sessionID: Schema.String,
    monitorID: Schema.String,
  })

  const MonitorLogQuery = Schema.Struct({
    lines: Schema.optional(Schema.NumberFromString),
  })

  export const Group = HttpApiGroup.make("session")
    .add(
      HttpApiEndpoint.get("list", "/", {
        query: ListQuery,
        success: SessionList,
      }),
    )
    .add(
      HttpApiEndpoint.post("create", "/", {
        payload: [HttpApiSchema.NoContent, CreatePayload],
        success: SessionInfo,
      }),
    )
    .add(HttpApiEndpoint.get("status", "/status", { success: SessionStatusMap }))
    .add(
      HttpApiEndpoint.get("get", "/:sessionID", {
        params: SessionIDPath,
        success: SessionInfo,
        error: [NotFound, Busy],
      }),
    )
    .add(
      HttpApiEndpoint.delete("remove", "/:sessionID", {
        params: SessionIDPath,
        success: BooleanResult,
        error: [NotFound, Busy],
      }).annotate(OpenApi.Identifier, "session.delete"),
    )
    .add(
      HttpApiEndpoint.patch("update", "/:sessionID", {
        params: SessionIDPath,
        payload: UpdatePayload,
        success: SessionInfo,
        error: [NotFound, Busy],
      }),
    )
    .add(
      HttpApiEndpoint.post("fork", "/:sessionID/fork", {
        params: SessionIDPath,
        payload: ForkPayload,
        success: SessionInfo,
        error: [NotFound, Busy],
      }),
    )
    .add(
      HttpApiEndpoint.post("abort", "/:sessionID/abort", {
        params: SessionIDPath,
        success: BooleanResult,
      }),
    )
    .add(
      HttpApiEndpoint.post("revert", "/:sessionID/revert", {
        params: SessionIDPath,
        payload: RevertPayload,
        success: SessionInfo,
        error: [NotFound, Busy],
      }),
    )
    .add(
      HttpApiEndpoint.post("unrevert", "/:sessionID/unrevert", {
        params: SessionIDPath,
        success: SessionInfo,
        error: [NotFound, Busy],
      }),
    )
    .add(
      HttpApiEndpoint.post("share", "/:sessionID/share", {
        params: SessionIDPath,
        success: SessionInfo,
        error: [NotFound, Busy],
      }),
    )
    .add(
      HttpApiEndpoint.delete("unshare", "/:sessionID/share", {
        params: SessionIDPath,
        success: SessionInfo,
        error: [NotFound, Busy],
      }),
    )
    .add(
      HttpApiEndpoint.post("summarize", "/:sessionID/summarize", {
        params: SessionIDPath,
        payload: SummarizePayload,
        success: BooleanResult,
        error: [NotFound, Busy],
      }),
    )
    .add(
      HttpApiEndpoint.post("command", "/:sessionID/command", {
        params: SessionIDPath,
        payload: CommandPayload,
        success: MessageWithParts,
        error: [NotFound, Busy],
      }),
    )
    .add(
      HttpApiEndpoint.post("shell", "/:sessionID/shell", {
        params: SessionIDPath,
        payload: ShellPayload,
        success: MessageWithParts,
        error: [NotFound, Busy],
      }),
    )
    .add(
      HttpApiEndpoint.post("permissionRespond", "/:sessionID/permissions/:permissionID", {
        params: PermissionRespondPath,
        payload: PermissionRespondPayload,
        success: BooleanResult,
        error: [NotFound, Busy],
      }).annotate(OpenApi.Identifier, "permission.respond"),
    )
    .add(
      HttpApiEndpoint.get("children", "/:sessionID/children", {
        params: SessionIDPath,
        success: SessionList,
        error: [NotFound, Busy],
      }),
    )
    .add(
      HttpApiEndpoint.get("todo", "/:sessionID/todo", {
        params: SessionIDPath,
        success: TodoList,
        error: [NotFound, Busy],
      }),
    )
    .add(
      HttpApiEndpoint.get("diff", "/:sessionID/diff", {
        params: SessionIDPath,
        query: DiffQuery,
        success: FileDiffList,
        error: [NotFound, Busy],
      }),
    )
    .add(
      HttpApiEndpoint.get("messages", "/:sessionID/message", {
        params: SessionIDPath,
        query: MessagesQuery,
        success: MessageList,
        error: [NotFound, Busy],
      }),
    )
    .add(
      HttpApiEndpoint.get("pending", "/:sessionID/pending", {
        params: SessionIDPath,
        success: PendingList,
        error: [NotFound, Busy],
      }),
    )
    .add(
      HttpApiEndpoint.post("pendingSteer", "/:sessionID/pending/:pendingID/steer", {
        params: PendingPath,
        success: SessionPending.InfoSchema,
        error: [NotFound, Busy],
      }),
    )
    .add(
      HttpApiEndpoint.get("message", "/:sessionID/message/:messageID", {
        params: MessagePath,
        success: MessageWithParts,
        error: [NotFound, Busy],
      }),
    )
    .add(
      HttpApiEndpoint.delete("messageRemove", "/:sessionID/message/:messageID", {
        params: MessagePath,
        success: BooleanResult,
        error: [NotFound, Busy],
      }),
    )
    .add(
      HttpApiEndpoint.delete("partRemove", "/:sessionID/message/:messageID/part/:partID", {
        params: PartPath,
        success: BooleanResult,
        error: [NotFound, Busy],
      }).annotate(OpenApi.Identifier, "part.delete"),
    )
    .add(
      HttpApiEndpoint.patch("partUpdate", "/:sessionID/message/:messageID/part/:partID", {
        params: PartPath,
        payload: MessagePart,
        success: MessagePart,
        error: [NotFound, Busy],
      }).annotate(OpenApi.Identifier, "part.update"),
    )
    .add(
      HttpApiEndpoint.get("v2Entries", "/:sessionID/v2/entries", {
        params: SessionIDPath,
        success: SessionV2EntryList,
        error: [NotFound, Busy],
      }).annotate(OpenApi.Identifier, "session.v2.entries"),
    )
    .add(
      HttpApiEndpoint.get("v2State", "/:sessionID/v2/state", {
        params: SessionIDPath,
        success: SessionV2State,
        error: [NotFound, Busy],
      }).annotate(OpenApi.Identifier, "session.v2.state"),
    )
    .add(
      HttpApiEndpoint.get("v2Events", "/:sessionID/v2/events", {
        params: SessionIDPath,
        success: SessionV2EventList,
        error: [NotFound, Busy],
      }).annotate(OpenApi.Identifier, "session.v2.events"),
    )
    .add(
      HttpApiEndpoint.get("instructions", "/:sessionID/instructions", {
        params: SessionIDPath,
        success: InstructionList,
        error: [NotFound, Busy],
      }),
    )
    .add(
      HttpApiEndpoint.get("contextBreakdown", "/:sessionID/context", {
        params: SessionIDPath,
        success: ContextBreakdown,
        error: [NotFound, Busy],
      }).annotate(OpenApi.Identifier, "session.context"),
    )
    .add(
      HttpApiEndpoint.post("contextToggle", "/:sessionID/context/toggle", {
        params: SessionIDPath,
        payload: ContextTogglePayload,
        success: ContextBreakdown,
        error: [NotFound, Busy],
      }),
    )
    .add(
      HttpApiEndpoint.get("goal", "/:sessionID/goal", {
        params: SessionIDPath,
        success: GoalOutput,
      }),
    )
    .add(
      HttpApiEndpoint.get("background", "/:sessionID/background", {
        params: SessionIDPath,
        success: BackgroundOutput,
        error: BackgroundNotFound,
      }),
    )
    .add(
      HttpApiEndpoint.get("backgroundInspect", "/:sessionID/background/:delegationID", {
        params: DelegationPath,
        success: BackgroundInspectOutput,
      }).annotate(OpenApi.Identifier, "session.background.inspect"),
    )
    .add(
      HttpApiEndpoint.get("backgroundRead", "/:sessionID/background/:delegationID/read", {
        params: DelegationPath,
        success: Schema.String,
      }).annotate(OpenApi.Identifier, "session.background.read"),
    )
    .add(
      HttpApiEndpoint.post("backgroundCancel", "/:sessionID/background/:delegationID/cancel", {
        params: DelegationPath,
        success: Schema.Boolean,
      }).annotate(OpenApi.Identifier, "session.background.cancel"),
    )
    .add(
      HttpApiEndpoint.get("monitor", "/:sessionID/monitor/:monitorID", {
        params: MonitorPath,
        success: MonitorOutput,
        error: [NotFound, Busy],
      }),
    )
    .add(
      HttpApiEndpoint.get("monitorLog", "/:sessionID/monitor/:monitorID/log", {
        params: MonitorPath,
        query: MonitorLogQuery,
        success: MonitorLogOutput,
        error: [NotFound, Busy],
      }),
    )
    .add(
      HttpApiEndpoint.post("monitorCancel", "/:sessionID/monitor/:monitorID/cancel", {
        params: MonitorPath,
        success: MonitorOutput,
        error: [NotFound, Busy],
      }),
    )
    .prefix("/session")

  export const Api = HttpApi.make("nikcli").add(Group)

  export const ApiLive = HttpApiBuilder.layer(Api)

  export const handlers = {
    list: ({ query }: { query: typeof ListQuery.Type }) =>
      Effect.gen(function* () {
        const ctx = yield* InstanceState.context
        const service = yield* Session.Service
        const iterable = yield* service.list()
        const sessions = yield* Effect.promise(() => Array.fromAsync(iterable))
        const term = query.search?.toLowerCase()
        const directory = WorkspaceContext.workspaceID ? ctx.directory : query.directory
        const filtered = sessions.filter((session) => {
          if (
            directory !== undefined &&
            Filesystem.comparisonKey(session.directory) !== Filesystem.comparisonKey(directory)
          )
            return false
          if (query.roots && session.parentID) return false
          if (query.start !== undefined && session.time.updated < query.start) return false
          if (term !== undefined && !session.title.toLowerCase().includes(term)) return false
          return true
        })
        filtered.sort((a, b) => b.time.updated - a.time.updated)
        const limited = query.limit !== undefined ? filtered.slice(0, query.limit) : filtered
        return jsonSafe(limited)
      }).pipe(Effect.orDie),
    status: () =>
      Effect.gen(function* () {
        const status = yield* SessionStatus.Service
        return yield* status.list()
      }).pipe(Effect.orDie),
    create: ({ payload }: { payload: typeof CreatePayload.Type | void }) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const created = yield* session.create((payload ?? {}) as Session.CreateInput)
        return jsonSafe(created)
      }).pipe(Effect.orDie),
    remove: ({ params }: { params: typeof SessionIDPath.Type }) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        yield* session.remove(params.sessionID)
        return true
      }).pipe(declaredErrors),
    update: ({ params, payload }: { params: typeof SessionIDPath.Type; payload: typeof UpdatePayload.Type }) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const updated = yield* session.update(
          params.sessionID,
          (draft) => {
            if (payload.title !== undefined) draft.title = payload.title
            if (payload.time?.archived !== undefined) draft.time.archived = payload.time.archived
          },
          { touch: false },
        )
        return jsonSafe(updated)
      }).pipe(declaredErrors),
    fork: ({ params, payload }: { params: typeof SessionIDPath.Type; payload: typeof ForkPayload.Type }) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const forked = yield* session.fork({
          sessionID: params.sessionID,
          messageID: payload.messageID,
        })
        return jsonSafe(forked)
      }).pipe(declaredErrors),
    abort: ({ params }: { params: typeof SessionIDPath.Type }) =>
      Effect.gen(function* () {
        yield* Effect.gen(function* () {
          const sessionPrompt = yield* SessionPrompt.Service
          yield* Effect.all(
            [
              Effect.promise(() => Delegation.cancelOwnedBySessionID(params.sessionID)),
              Effect.promise(() => Monitor.cancelAll(params.sessionID)),
              sessionPrompt.cancel(params.sessionID),
            ],
            { concurrency: "unbounded", discard: true },
          )
        }).pipe(Effect.catchCauseIf(Cause.hasInterruptsOnly, () => Effect.void))
        return true
      }).pipe(Effect.orDie),
    revert: ({ params, payload }: { params: typeof SessionIDPath.Type; payload: typeof RevertPayload.Type }) =>
      Effect.gen(function* () {
        const revert = yield* SessionRevert.Service
        const reverted = yield* revert.revert({
          sessionID: params.sessionID,
          ...payload,
        })
        return jsonSafe(reverted)
      }).pipe(declaredErrors),
    unrevert: ({ params }: { params: typeof SessionIDPath.Type }) =>
      Effect.gen(function* () {
        const revert = yield* SessionRevert.Service
        const reverted = yield* revert.unrevert({
          sessionID: params.sessionID,
        })
        return jsonSafe(reverted)
      }).pipe(declaredErrors),
    share: ({
      params,
      request,
    }: {
      params: typeof SessionIDPath.Type
      request: { headers: Record<string, string | undefined> }
    }) =>
      Effect.gen(function* () {
        const configService = yield* Config.Service
        const config = yield* configService.get()
        if (config.share === "disabled") {
          return yield* Effect.die(new Error("Sharing is disabled in configuration"))
        }
        // Mirror the Hono route's origin handling: local nikcli.local hosts
        // use the default share base URL, anything else passes its origin.
        const host = request.headers["host"]
        const proto = request.headers["x-forwarded-proto"] ?? "http"
        const origin = host ? `${proto}://${host}` : undefined
        const shareNext = yield* ShareNext.Service
        const share = yield* shareNext.create(
          params.sessionID,
          origin && !/^https?:\/\/nikcli\.local(?::\d+)?$/i.test(origin) ? { baseUrl: origin } : undefined,
        )
        const session = yield* Session.Service
        yield* session.update(
          params.sessionID,
          (draft) => {
            draft.share = { url: share.url }
          },
          { touch: false },
        )
        return jsonSafe(yield* session.get(params.sessionID))
      }).pipe(declaredErrors),
    unshare: ({ params }: { params: typeof SessionIDPath.Type }) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        yield* session.unshare(params.sessionID)
        return jsonSafe(yield* session.get(params.sessionID))
      }).pipe(declaredErrors),
    command: ({ params, payload }: { params: typeof SessionIDPath.Type; payload: typeof CommandPayload.Type }) =>
      Effect.gen(function* () {
        const sessionPrompt = yield* SessionPrompt.Service
        const msg = yield* sessionPrompt.command({
          ...payload,
          sessionID: params.sessionID,
        } as SessionPrompt.CommandInput)
        return jsonSafe(msg)
      }).pipe(declaredErrors),
    shell: ({ params, payload }: { params: typeof SessionIDPath.Type; payload: typeof ShellPayload.Type }) =>
      Effect.gen(function* () {
        const sessionPrompt = yield* SessionPrompt.Service
        const msg = yield* sessionPrompt.shell({
          ...payload,
          sessionID: params.sessionID,
        } as SessionPrompt.ShellInput)
        return jsonSafe(msg)
      }).pipe(declaredErrors),
    permissionRespond: ({
      params,
      payload,
    }: {
      params: typeof PermissionRespondPath.Type
      payload: typeof PermissionRespondPayload.Type
    }) =>
      Effect.gen(function* () {
        const permission = yield* PermissionNext.Service
        yield* permission.reply({
          requestID: params.permissionID,
          reply: payload.response,
        })
        return true
      }).pipe(declaredErrors),
    summarize: ({ params, payload }: { params: typeof SessionIDPath.Type; payload: typeof SummarizePayload.Type }) =>
      Effect.gen(function* () {
        const service = yield* Session.Service
        const session = yield* service.get(params.sessionID)
        const msgs = yield* service.messages({ sessionID: params.sessionID })
        const revert = yield* SessionRevert.Service
        yield* revert.cleanup(session)
        const agentService = yield* Agent.Service
        let currentAgent = yield* agentService.defaultAgent()
        for (let i = msgs.length - 1; i >= 0; i--) {
          const info = msgs[i].info
          if (info.role === "user") {
            currentAgent = info.agent || currentAgent
            break
          }
        }
        const compaction = yield* SessionCompaction.Service
        yield* compaction.create({
          sessionID: params.sessionID,
          agent: currentAgent,
          model: {
            providerID: payload.providerID,
            modelID: payload.modelID,
          },
          auto: payload.auto ?? false,
        })
        const sessionPrompt = yield* SessionPrompt.Service
        yield* sessionPrompt.loop(params.sessionID)
        return true
      }).pipe(declaredErrors),
    get: ({ params }: { params: typeof SessionIDPath.Type }) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const info = yield* session.get(params.sessionID)
        return jsonSafe(info)
      }).pipe(declaredErrors),
    children: ({ params }: { params: typeof SessionIDPath.Type }) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const children = yield* session.children(params.sessionID)
        return jsonSafe(children)
      }).pipe(declaredErrors),
    todo: ({ params }: { params: typeof SessionIDPath.Type }) =>
      Effect.gen(function* () {
        const todo = yield* Todo.Service
        return yield* todo.get(params.sessionID)
      }).pipe(declaredErrors),
    diff: ({ params, query }: { params: typeof SessionIDPath.Type; query: typeof DiffQuery.Type }) =>
      Effect.gen(function* () {
        const summary = yield* SessionSummary.Service
        return yield* summary.diff({
          sessionID: params.sessionID,
          messageID: query.messageID,
        })
      }).pipe(declaredErrors),
    messages: ({ params, query }: { params: typeof SessionIDPath.Type; query: typeof MessagesQuery.Type }) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const msgs = yield* session.messages({
          sessionID: params.sessionID,
          limit: query.limit,
        })
        return jsonSafe(msgs)
      }).pipe(declaredErrors),
    pending: ({ params }: { params: typeof SessionIDPath.Type }) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        yield* session.get(params.sessionID)
        return jsonSafe(SessionPending.list(params.sessionID))
      }).pipe(declaredErrors),
    pendingSteer: ({ params }: { params: typeof PendingPath.Type }) =>
      Effect.gen(function* () {
        const prompt = yield* SessionPrompt.Service
        return jsonSafe(yield* prompt.steerPending(params))
      }).pipe(declaredErrors),
    message: ({ params }: { params: typeof MessagePath.Type }) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        yield* session.get(params.sessionID)
        const msg = yield* Effect.promise(() => MessageV2.get(params))
        return jsonSafe(msg)
      }).pipe(declaredErrors),
    messageRemove: ({ params }: { params: typeof MessagePath.Type }) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        yield* session.get(params.sessionID)
        yield* session.removeMessage({
          sessionID: params.sessionID,
          messageID: params.messageID,
        })
        return true
      }).pipe(declaredErrors),
    partRemove: ({ params }: { params: typeof PartPath.Type }) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        yield* session.get(params.sessionID)
        yield* session.removePart(params)
        return true
      }).pipe(declaredErrors),
    partUpdate: ({ params, payload }: { params: typeof PartPath.Type; payload: unknown }) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        yield* session.get(params.sessionID)
        const part = MessageV2.Part.parse(payload)
        if (part.id !== params.partID || part.messageID !== params.messageID || part.sessionID !== params.sessionID) {
          throw new Error(
            `Part mismatch: body.id='${part.id}' vs partID='${params.partID}', body.messageID='${part.messageID}' vs messageID='${params.messageID}', body.sessionID='${part.sessionID}' vs sessionID='${params.sessionID}'`,
          )
        }
        yield* Effect.promise(() =>
          MessageV2.get({
            sessionID: params.sessionID,
            messageID: params.messageID,
          }),
        )
        return yield* session.updatePart(part)
      }).pipe(declaredErrors),
    v2Entries: ({ params }: { params: typeof SessionIDPath.Type }) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        yield* session.get(params.sessionID)
        const entries = yield* Effect.promise(() => SessionV2.entries(params.sessionID))
        return jsonSafe(entries)
      }).pipe(declaredErrors),
    v2State: ({ params }: { params: typeof SessionIDPath.Type }) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        yield* session.get(params.sessionID)
        const live = SessionV2.state(params.sessionID)
        return jsonSafe({ entries: live.entries, pending: live.pending })
      }).pipe(declaredErrors),
    v2Events: ({ params }: { params: typeof SessionIDPath.Type }) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        yield* session.get(params.sessionID)
        return jsonSafe(SessionV2.events(params.sessionID))
      }).pipe(declaredErrors),
    instructions: ({ params }: { params: typeof SessionIDPath.Type }) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        yield* session.get(params.sessionID)
        const ctx = yield* InstanceState.context
        const config = yield* Config.Service
        const cfg = yield* config.get()
        const { collectSystemPaths } = yield* Effect.promise(() => import("@/session/instruction"))
        const result = yield* Effect.promise(() => collectSystemPaths(ctx, cfg))
        return Array.from(result.paths).map((p) => ({
          path: p,
          name: p.split("/").pop() || p,
        }))
      }).pipe(declaredErrors),
    contextBreakdown: ({ params }: { params: typeof SessionIDPath.Type }) =>
      Effect.gen(function* () {
        const result = yield* Effect.promise(() => SessionContext.breakdown(params.sessionID))
        return jsonSafe(result)
      }).pipe(declaredErrors),
    contextToggle: ({
      params,
      payload,
    }: {
      params: typeof SessionIDPath.Type
      payload: typeof ContextTogglePayload.Type
    }) =>
      Effect.gen(function* () {
        const { kind, key, enabled } = payload
        if (kind === "mcp") {
          const config = yield* Config.Service
          yield* config.update({ mcp: { [key]: { enabled } } })
          const mcp = yield* MCP.Service
          yield* (enabled ? mcp.connect(key) : mcp.disconnect(key)).pipe(
            Effect.catch((e: unknown) =>
              Effect.sync(() =>
                log.warn("mcp toggle connect/disconnect failed", {
                  key,
                  error: String(e),
                }),
              ),
            ),
            Effect.catchDefect((e) =>
              Effect.sync(() =>
                log.warn("mcp toggle connect/disconnect failed", {
                  key,
                  error: String(e),
                }),
              ),
            ),
          )
        } else if (kind === "skill") {
          const session = yield* Session.Service
          yield* session.update(params.sessionID, (draft) => {
            const set = new Set(draft.skills ?? [])
            if (enabled) set.add(key)
            else set.delete(key)
            draft.skills = [...set]
          })
        } else if (kind === "tool") {
          const session = yield* Session.Service
          yield* session.update(params.sessionID, (draft) => {
            const map = { ...draft.disabledTools }
            // `false`, not a deleted key: an opt-in tool (`ToolRegistry.OPT_IN`)
            // reads an absent entry as "never asked for" and stays off, so
            // enabling has to be recorded.
            map[key] = !enabled
            draft.disabledTools = map
          })
        } else {
          const session = yield* Session.Service
          yield* session.update(params.sessionID, (draft) => {
            const set = new Set(draft.disabledInstructions ?? [])
            if (enabled) set.delete(key)
            else set.add(key)
            draft.disabledInstructions = [...set]
          })
        }
        const result = yield* Effect.promise(() => SessionContext.breakdown(params.sessionID))
        return jsonSafe(result)
      }).pipe(declaredErrors),
    goal: ({ params }: { params: typeof SessionIDPath.Type }) =>
      Effect.gen(function* () {
        const goal = yield* SessionGoal.Service
        const state = yield* goal.get(params.sessionID)
        return jsonSafe(state ?? null)
      }).pipe(Effect.orDie),
    background: ({ params }: { params: typeof SessionIDPath.Type }) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const found = yield* session.get(params.sessionID).pipe(
          Effect.catch(() => Effect.succeed(undefined)),
          Effect.catchDefect(() => Effect.succeed(undefined)),
        )
        if (!found) {
          return yield* Effect.fail({ error: "Session not found" as const })
        }
        const jobs = yield* Effect.promise(() => Delegation.listJobs(params.sessionID))
        return jsonSafe(jobs)
      }),
    backgroundInspect: ({ params }: { params: typeof DelegationPath.Type }) =>
      Effect.promise(() => Delegation.inspectJobForSession(params.sessionID, params.delegationID)).pipe(
        Effect.map((job) => jsonSafe(job ?? null)),
        Effect.orDie,
      ),
    backgroundRead: ({ params }: { params: typeof DelegationPath.Type }) =>
      Effect.promise(() => Delegation.readJobForSession(params.sessionID, params.delegationID)).pipe(
        Effect.map((output) => output ?? ""),
        Effect.orDie,
      ),
    backgroundCancel: ({ params }: { params: typeof DelegationPath.Type }) =>
      Effect.promise(() => Delegation.cancelJobForSession(params.sessionID, params.delegationID)).pipe(Effect.orDie),
    monitor: ({ params }: { params: typeof MonitorPath.Type }) =>
      Effect.gen(function* () {
        const record = yield* Effect.promise(() => Monitor.get(params.sessionID, params.monitorID))
        return jsonSafe(record ?? null)
      }).pipe(declaredErrors),
    monitorLog: ({ params, query }: { params: typeof MonitorPath.Type; query: typeof MonitorLogQuery.Type }) =>
      Effect.gen(function* () {
        const snapshot = yield* Effect.promise(() =>
          Monitor.readLog(params.sessionID, params.monitorID, query.lines ?? 200),
        )
        return jsonSafe(snapshot ?? null)
      }).pipe(declaredErrors),
    monitorCancel: ({ params }: { params: typeof MonitorPath.Type }) =>
      Effect.gen(function* () {
        const record = yield* Effect.promise(() => Monitor.cancel(params.sessionID, params.monitorID))
        return jsonSafe(record ?? null)
      }).pipe(declaredErrors),
  }

  export const HandlersLive = HttpApiBuilder.group(Api, "session", (builder) =>
    builder
      .handle("list", (request) => handlers.list(request))
      .handle("create", (request) => handlers.create(request))
      .handle("status", () => handlers.status())
      .handle("get", (request) => handlers.get(request))
      .handle("remove", (request) => handlers.remove(request))
      .handle("update", (request) => handlers.update(request))
      .handle("fork", (request) => handlers.fork(request))
      .handle("abort", (request) => handlers.abort(request))
      .handle("revert", (request) => handlers.revert(request))
      .handle("unrevert", (request) => handlers.unrevert(request))
      .handle("share", (request) => handlers.share(request))
      .handle("unshare", (request) => handlers.unshare(request))
      .handle("summarize", (request) => handlers.summarize(request))
      .handle("command", (request) => handlers.command(request))
      .handle("shell", (request) => handlers.shell(request))
      .handle("permissionRespond", (request) => handlers.permissionRespond(request))
      .handle("children", (request) => handlers.children(request))
      .handle("todo", (request) => handlers.todo(request))
      .handle("diff", (request) => handlers.diff(request))
      .handle("messages", (request) => handlers.messages(request))
      .handle("pending", (request) => handlers.pending(request))
      .handle("pendingSteer", (request) => handlers.pendingSteer(request))
      .handle("message", (request) => handlers.message(request))
      .handle("messageRemove", (request) => handlers.messageRemove(request))
      .handle("partRemove", (request) => handlers.partRemove(request))
      .handle("partUpdate", (request) => handlers.partUpdate(request))
      .handle("v2Entries", (request) => handlers.v2Entries(request))
      .handle("v2State", (request) => handlers.v2State(request))
      .handle("v2Events", (request) => handlers.v2Events(request))
      .handle("instructions", (request) => handlers.instructions(request))
      .handle("contextBreakdown", (request) => handlers.contextBreakdown(request))
      .handle("contextToggle", (request) => handlers.contextToggle(request))
      .handle("goal", (request) => handlers.goal(request))
      .handle("background", (request) => handlers.background(request))
      .handle("backgroundInspect", (request) => handlers.backgroundInspect(request))
      .handle("backgroundRead", (request) => handlers.backgroundRead(request))
      .handle("backgroundCancel", (request) => handlers.backgroundCancel(request))
      .handle("monitor", (request) => handlers.monitor(request))
      .handle("monitorLog", (request) => handlers.monitorLog(request))
      .handle("monitorCancel", (request) => handlers.monitorCancel(request)),
  )

  export const DependenciesLive = Layer.mergeAll(
    Session.defaultLayer,
    SessionPrompt.defaultLayer,
    SessionRevert.defaultLayer,
    SessionSummary.defaultLayer,
    SessionStatus.defaultLayer,
    Todo.defaultLayer,
    ShareNext.defaultLayer,
    SessionCompaction.defaultLayer,
    Agent.defaultLayer,
    Config.defaultLayer,
    PermissionNext.defaultLayer,
    SessionGoal.defaultLayer,
    MCP.defaultLayer,
  ) as Layer.Layer<
    | Session.Service
    | SessionPrompt.Service
    | SessionRevert.Service
    | SessionSummary.Service
    | SessionStatus.Service
    | Todo.Service
    | ShareNext.Service
    | SessionCompaction.Service
    | Agent.Service
    | Config.Service
    | PermissionNext.Service
    | SessionGoal.Service
    | MCP.Service,
    never,
    never
  >

  export const layer = ApiLive.pipe(Layer.provide(HandlersLive), Layer.provide(DependenciesLive))
}
