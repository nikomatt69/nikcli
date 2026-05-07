import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
} from "@effect/platform"
import { Effect, Layer, Schema } from "effect"
import { PermissionNext } from "@/permission/next"

export namespace PermissionHttpApi {
  export const Reply = Schema.Literal("once", "always", "reject").annotations({ identifier: "PermissionReply" })

  export const Request = Schema.Struct({
    id: Schema.String,
    sessionID: Schema.String,
    permission: Schema.String,
    patterns: Schema.Array(Schema.String),
    metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
    always: Schema.Array(Schema.String),
    tool: Schema.optional(
      Schema.Struct({
        messageID: Schema.String,
        callID: Schema.String,
      }),
    ),
  }).annotations({ identifier: "PermissionRequest" })

  export const ReplyInput = Schema.Struct({
    reply: Reply,
    message: Schema.optional(Schema.String),
  }).annotations({ identifier: "PermissionReplyInput" })

  const RequestPath = Schema.Struct({
    requestID: Schema.String,
  })

  export const Group = HttpApiGroup.make("permission")
    .add(HttpApiEndpoint.get("list", "/").addSuccess(Schema.Array(Request)))
    .add(
      HttpApiEndpoint.post("reply", "/:requestID/reply")
        .setPath(RequestPath)
        .setPayload(ReplyInput)
        .addSuccess(Schema.Boolean),
    )
    .prefix("/permission")

  export const Api = HttpApi.make("nikcli").add(Group)

  export const ApiLive = HttpApiBuilder.api(Api)

  export const handlers = {
    list: () =>
      Effect.gen(function* () {
        const permission = yield* PermissionNext.Service
        return yield* permission.list()
      }),
    reply: ({ path, payload }: { path: { requestID: string }; payload: typeof ReplyInput.Type }) =>
      Effect.gen(function* () {
        const permission = yield* PermissionNext.Service
        yield* permission.reply({
          requestID: path.requestID,
          reply: payload.reply,
          message: payload.message,
        })
        return true
      }),
  }

  export const HandlersLive = HttpApiBuilder.group(Api, "permission", (builder) =>
    builder
      .handle("list", handlers.list)
      .handle("reply", handlers.reply),
  )

  export const layer = ApiLive.pipe(
    Layer.provide(HandlersLive),
    Layer.provide(PermissionNext.defaultLayer),
  )
}
