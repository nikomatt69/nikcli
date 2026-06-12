import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { Cause, Effect, Layer, Schema, SchemaGetter } from "effect"
import { Delegation } from "@/delegation/manager"
import { InstanceState } from "@/effect"
import { Monitor } from "@/monitor/manager"
import { Session } from "@/session"
import { Storage } from "@/storage/storage"
import { MessageV2 } from "@/session/message-v2"
import { SessionPrompt } from "@/session/prompt"
import { SessionRevert } from "@/session/revert"
import { SessionSummary } from "@/session/summary"
import { SessionStatus } from "@/session/status"
import { Todo } from "@/session/todo"
import { WorkspaceContext } from "@/workspace/workspace-context"

export namespace SessionHttpApi {
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

  const SessionList = Schema.Array(Schema.Unknown).annotate({ identifier: "SessionList" })
  const MessageList = Schema.Array(Schema.Unknown).annotate({ identifier: "MessageList" })
  const FileDiffList = Schema.Array(Schema.Unknown).annotate({ identifier: "FileDiffList" })
  const SessionInfo = Schema.Unknown.annotate({ identifier: "SessionInfo" })
  const SessionStatusMap = Schema.Record(Schema.String, Schema.Unknown).annotate({
    identifier: "SessionStatusMap",
  })
  const TodoList = Schema.Array(Schema.Unknown).annotate({ identifier: "TodoList" })
  const BooleanResult = Schema.Boolean.annotate({ identifier: "BooleanResult" })
  const SessionIDPath = Schema.Struct({
    sessionID: Schema.String,
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
  const MessageWithParts = Schema.Unknown.annotate({ identifier: "MessageWithParts" })
  const MessagePart = Schema.Unknown.annotate({ identifier: "MessagePart" })

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
  const Busy = Schema.Struct({
    name: Schema.Literal("SessionBusyError"),
    data: Schema.Record(Schema.String, Schema.Unknown),
  }).annotate({ identifier: "SessionBusyErrorBody", httpApiStatus: 409 })

  type DeclaredError = typeof NotFound.Type | typeof Busy.Type

  /** Expected boundary failures → declared errors; everything else is a defect. */
  function asSessionError(cause: unknown): Effect.Effect<never, DeclaredError> {
    if (cause instanceof Storage.NotFoundError) {
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

  export const Group = HttpApiGroup.make("session")
    .add(HttpApiEndpoint.get("list", "/", { query: ListQuery, success: SessionList }))
    .add(HttpApiEndpoint.post("create", "/", { payload: CreatePayload, success: SessionInfo }))
    .add(HttpApiEndpoint.get("status", "/status", { success: SessionStatusMap }))
    .add(HttpApiEndpoint.get("get", "/:sessionID", { params: SessionIDPath, success: SessionInfo, error: [NotFound, Busy] }))
    .add(HttpApiEndpoint.delete("remove", "/:sessionID", { params: SessionIDPath, success: BooleanResult, error: [NotFound, Busy] }))
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
    .add(HttpApiEndpoint.post("abort", "/:sessionID/abort", { params: SessionIDPath, success: BooleanResult }))
    .add(
      HttpApiEndpoint.post("revert", "/:sessionID/revert", {
        params: SessionIDPath,
        payload: RevertPayload,
        success: SessionInfo,
        error: [NotFound, Busy],
      }),
    )
    .add(HttpApiEndpoint.post("unrevert", "/:sessionID/unrevert", { params: SessionIDPath, success: SessionInfo, error: [NotFound, Busy] }))
    .add(HttpApiEndpoint.get("children", "/:sessionID/children", { params: SessionIDPath, success: SessionList, error: [NotFound, Busy] }))
    .add(HttpApiEndpoint.get("todo", "/:sessionID/todo", { params: SessionIDPath, success: TodoList, error: [NotFound, Busy] }))
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
      }),
    )
    .add(
      HttpApiEndpoint.patch("partUpdate", "/:sessionID/message/:messageID/part/:partID", {
        params: PartPath,
        payload: MessagePart,
        success: MessagePart,
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
          if (directory !== undefined && session.directory !== directory) return false
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
    create: ({ payload }: { payload: typeof CreatePayload.Type }) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const created = yield* session.create(payload as Session.CreateInput)
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
        const forked = yield* session.fork({ sessionID: params.sessionID, messageID: payload.messageID })
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
        const reverted = yield* revert.revert({ sessionID: params.sessionID, ...payload })
        return jsonSafe(reverted)
      }).pipe(declaredErrors),
    unrevert: ({ params }: { params: typeof SessionIDPath.Type }) =>
      Effect.gen(function* () {
        const revert = yield* SessionRevert.Service
        const reverted = yield* revert.unrevert({ sessionID: params.sessionID })
        return jsonSafe(reverted)
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
        return yield* summary.diff({ sessionID: params.sessionID, messageID: query.messageID })
      }).pipe(declaredErrors),
    messages: ({ params, query }: { params: typeof SessionIDPath.Type; query: typeof MessagesQuery.Type }) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const msgs = yield* session.messages({ sessionID: params.sessionID, limit: query.limit })
        return jsonSafe(msgs)
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
        yield* session.removeMessage({ sessionID: params.sessionID, messageID: params.messageID })
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
        yield* Effect.promise(() => MessageV2.get({ sessionID: params.sessionID, messageID: params.messageID }))
        return yield* session.updatePart(part)
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
      .handle("children", (request) => handlers.children(request))
      .handle("todo", (request) => handlers.todo(request))
      .handle("diff", (request) => handlers.diff(request))
      .handle("messages", (request) => handlers.messages(request))
      .handle("message", (request) => handlers.message(request))
      .handle("messageRemove", (request) => handlers.messageRemove(request))
      .handle("partRemove", (request) => handlers.partRemove(request))
      .handle("partUpdate", (request) => handlers.partUpdate(request)),
  )

  export const DependenciesLive = Layer.mergeAll(
    Session.defaultLayer,
    SessionPrompt.defaultLayer,
    SessionRevert.defaultLayer,
    SessionSummary.defaultLayer,
    SessionStatus.defaultLayer,
    Todo.defaultLayer,
  ) as Layer.Layer<
    | Session.Service
    | SessionPrompt.Service
    | SessionRevert.Service
    | SessionSummary.Service
    | SessionStatus.Service
    | Todo.Service,
    never,
    never
  >

  export const layer = ApiLive.pipe(Layer.provide(HandlersLive), Layer.provide(DependenciesLive))
}
