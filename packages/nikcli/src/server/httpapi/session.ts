import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "@effect/platform"
import { Effect, Layer, Schema } from "effect"
import { Delegation } from "@/delegation/manager"
import { InstanceState } from "@/effect"
import { Monitor } from "@/monitor/manager"
import { Session } from "@/session"
import { MessageV2 } from "@/session/message-v2"
import { SessionPrompt } from "@/session/prompt"
import { SessionRevert } from "@/session/revert"
import { SessionSummary } from "@/session/summary"
import { SessionStatus } from "@/session/status"
import { Todo } from "@/session/todo"
import { WorkspaceContext } from "@/workspace/workspace-context"

export namespace SessionHttpApi {
  const ListQuery = Schema.Struct({
    directory: Schema.optional(Schema.String),
    roots: Schema.optional(Schema.BooleanFromString),
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
  }).annotations({ identifier: "SessionCreateInput" })
  const UpdatePayload = Schema.Struct({
    title: Schema.optional(Schema.String),
    time: Schema.optional(
      Schema.Struct({
        archived: Schema.optional(Schema.Number),
      }),
    ),
  }).annotations({ identifier: "SessionUpdateInput" })
  const ForkPayload = Schema.Struct({
    messageID: Schema.optional(Schema.String),
  }).annotations({ identifier: "SessionForkInput" })
  const RevertPayload = Schema.Struct({
    messageID: Schema.String,
    partID: Schema.optional(Schema.String),
  }).annotations({ identifier: "SessionRevertInput" })

  const SessionList = Schema.Array(Schema.Unknown).annotations({ identifier: "SessionList" })
  const MessageList = Schema.Array(Schema.Unknown).annotations({ identifier: "MessageList" })
  const FileDiffList = Schema.Array(Schema.Unknown).annotations({ identifier: "FileDiffList" })
  const SessionInfo = Schema.Unknown.annotations({ identifier: "SessionInfo" })
  const SessionStatusMap = Schema.Record({ key: Schema.String, value: Schema.Unknown }).annotations({
    identifier: "SessionStatusMap",
  })
  const TodoList = Schema.Array(Schema.Unknown).annotations({ identifier: "TodoList" })
  const BooleanResult = Schema.Boolean.annotations({ identifier: "BooleanResult" })
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
  const MessageWithParts = Schema.Unknown.annotations({ identifier: "MessageWithParts" })
  const MessagePart = Schema.Unknown.annotations({ identifier: "MessagePart" })

  export const Group = HttpApiGroup.make("session")
    .add(HttpApiEndpoint.get("list", "/").setUrlParams(ListQuery).addSuccess(SessionList))
    .add(HttpApiEndpoint.post("create", "/").setPayload(CreatePayload).addSuccess(SessionInfo))
    .add(HttpApiEndpoint.get("status", "/status").addSuccess(SessionStatusMap))
    .add(HttpApiEndpoint.get("get", "/:sessionID").setPath(SessionIDPath).addSuccess(SessionInfo))
    .add(HttpApiEndpoint.del("remove", "/:sessionID").setPath(SessionIDPath).addSuccess(BooleanResult))
    .add(
      HttpApiEndpoint.patch("update", "/:sessionID")
        .setPath(SessionIDPath)
        .setPayload(UpdatePayload)
        .addSuccess(SessionInfo),
    )
    .add(
      HttpApiEndpoint.post("fork", "/:sessionID/fork")
        .setPath(SessionIDPath)
        .setPayload(ForkPayload)
        .addSuccess(SessionInfo),
    )
    .add(HttpApiEndpoint.post("abort", "/:sessionID/abort").setPath(SessionIDPath).addSuccess(BooleanResult))
    .add(
      HttpApiEndpoint.post("revert", "/:sessionID/revert")
        .setPath(SessionIDPath)
        .setPayload(RevertPayload)
        .addSuccess(SessionInfo),
    )
    .add(HttpApiEndpoint.post("unrevert", "/:sessionID/unrevert").setPath(SessionIDPath).addSuccess(SessionInfo))
    .add(HttpApiEndpoint.get("children", "/:sessionID/children").setPath(SessionIDPath).addSuccess(SessionList))
    .add(HttpApiEndpoint.get("todo", "/:sessionID/todo").setPath(SessionIDPath).addSuccess(TodoList))
    .add(HttpApiEndpoint.get("diff", "/:sessionID/diff").setPath(SessionIDPath).setUrlParams(DiffQuery).addSuccess(FileDiffList))
    .add(
      HttpApiEndpoint.get("messages", "/:sessionID/message")
        .setPath(SessionIDPath)
        .setUrlParams(MessagesQuery)
        .addSuccess(MessageList),
    )
    .add(HttpApiEndpoint.get("message", "/:sessionID/message/:messageID").setPath(MessagePath).addSuccess(MessageWithParts))
    .add(HttpApiEndpoint.del("messageRemove", "/:sessionID/message/:messageID").setPath(MessagePath).addSuccess(BooleanResult))
    .add(HttpApiEndpoint.del("partRemove", "/:sessionID/message/:messageID/part/:partID").setPath(PartPath).addSuccess(BooleanResult))
    .add(
      HttpApiEndpoint.patch("partUpdate", "/:sessionID/message/:messageID/part/:partID")
        .setPath(PartPath)
        .setPayload(MessagePart)
        .addSuccess(MessagePart),
    )
    .prefix("/session")

  export const Api = HttpApi.make("nikcli").add(Group)

  export const ApiLive = HttpApiBuilder.api(Api)

  export const handlers = {
    list: ({ urlParams }: { urlParams: typeof ListQuery.Type }) =>
      Effect.gen(function* () {
        const ctx = yield* InstanceState.context
        const service = yield* Session.Service
        const iterable = yield* service.list()
        const sessions = yield* Effect.promise(() => Array.fromAsync(iterable))
        const term = urlParams.search?.toLowerCase()
        const directory = WorkspaceContext.workspaceID ? ctx.directory : urlParams.directory
        const filtered = sessions.filter((session) => {
          if (directory !== undefined && session.directory !== directory) return false
          if (urlParams.roots && session.parentID) return false
          if (urlParams.start !== undefined && session.time.updated < urlParams.start) return false
          if (term !== undefined && !session.title.toLowerCase().includes(term)) return false
          return true
        })
        filtered.sort((a, b) => b.time.updated - a.time.updated)
        return urlParams.limit !== undefined ? filtered.slice(0, urlParams.limit) : filtered
      }).pipe(Effect.orDie),
    status: () =>
      Effect.gen(function* () {
        const status = yield* SessionStatus.Service
        return yield* status.list()
      }).pipe(Effect.orDie),
    create: ({ payload }: { payload: typeof CreatePayload.Type }) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        return yield* session.create(payload as Session.CreateInput)
      }).pipe(Effect.orDie),
    remove: ({ path }: { path: typeof SessionIDPath.Type }) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        yield* session.remove(path.sessionID)
        return true
      }).pipe(Effect.orDie),
    update: ({ path, payload }: { path: typeof SessionIDPath.Type; payload: typeof UpdatePayload.Type }) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        return yield* session.update(
          path.sessionID,
          (draft) => {
            if (payload.title !== undefined) draft.title = payload.title
            if (payload.time?.archived !== undefined) draft.time.archived = payload.time.archived
          },
          { touch: false },
        )
      }).pipe(Effect.orDie),
    fork: ({ path, payload }: { path: typeof SessionIDPath.Type; payload: typeof ForkPayload.Type }) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        return yield* session.fork({ sessionID: path.sessionID, messageID: payload.messageID })
      }).pipe(Effect.orDie),
    abort: ({ path }: { path: typeof SessionIDPath.Type }) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => Delegation.cancelOwnedBySessionID(path.sessionID))
        yield* Effect.promise(() => Monitor.cancelAll(path.sessionID))
        const sessionPrompt = yield* SessionPrompt.Service
        yield* sessionPrompt.cancel(path.sessionID)
        return true
      }).pipe(Effect.orDie),
    revert: ({ path, payload }: { path: typeof SessionIDPath.Type; payload: typeof RevertPayload.Type }) =>
      Effect.gen(function* () {
        const revert = yield* SessionRevert.Service
        return yield* revert.revert({ sessionID: path.sessionID, ...payload })
      }).pipe(Effect.orDie),
    unrevert: ({ path }: { path: typeof SessionIDPath.Type }) =>
      Effect.gen(function* () {
        const revert = yield* SessionRevert.Service
        return yield* revert.unrevert({ sessionID: path.sessionID })
      }).pipe(Effect.orDie),
    get: ({ path }: { path: typeof SessionIDPath.Type }) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        return yield* session.get(path.sessionID)
      }).pipe(Effect.orDie),
    children: ({ path }: { path: typeof SessionIDPath.Type }) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        return yield* session.children(path.sessionID)
      }).pipe(Effect.orDie),
    todo: ({ path }: { path: typeof SessionIDPath.Type }) =>
      Effect.gen(function* () {
        const todo = yield* Todo.Service
        return yield* todo.get(path.sessionID)
      }).pipe(Effect.orDie),
    diff: ({ path, urlParams }: { path: typeof SessionIDPath.Type; urlParams: typeof DiffQuery.Type }) =>
      Effect.gen(function* () {
        const summary = yield* SessionSummary.Service
        return yield* summary.diff({ sessionID: path.sessionID, messageID: urlParams.messageID })
      }).pipe(Effect.orDie),
    messages: ({ path, urlParams }: { path: typeof SessionIDPath.Type; urlParams: typeof MessagesQuery.Type }) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        return yield* session.messages({ sessionID: path.sessionID, limit: urlParams.limit })
      }).pipe(Effect.orDie),
    message: ({ path }: { path: typeof MessagePath.Type }) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        yield* session.get(path.sessionID)
        return yield* Effect.promise(() => MessageV2.get(path))
      }).pipe(Effect.orDie),
    messageRemove: ({ path }: { path: typeof MessagePath.Type }) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        yield* session.get(path.sessionID)
        yield* session.removeMessage({ sessionID: path.sessionID, messageID: path.messageID })
        return true
      }).pipe(Effect.orDie),
    partRemove: ({ path }: { path: typeof PartPath.Type }) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        yield* session.get(path.sessionID)
        yield* session.removePart(path)
        return true
      }).pipe(Effect.orDie),
    partUpdate: ({ path, payload }: { path: typeof PartPath.Type; payload: unknown }) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        yield* session.get(path.sessionID)
        const part = MessageV2.Part.parse(payload)
        if (part.id !== path.partID || part.messageID !== path.messageID || part.sessionID !== path.sessionID) {
          throw new Error(
            `Part mismatch: body.id='${part.id}' vs partID='${path.partID}', body.messageID='${part.messageID}' vs messageID='${path.messageID}', body.sessionID='${part.sessionID}' vs sessionID='${path.sessionID}'`,
          )
        }
        yield* Effect.promise(() => MessageV2.get({ sessionID: path.sessionID, messageID: path.messageID }))
        return yield* session.updatePart(part)
      }).pipe(Effect.orDie),
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

  export const layer = ApiLive.pipe(
    Layer.provide(HandlersLive),
    Layer.provide(DependenciesLive),
  )
}
