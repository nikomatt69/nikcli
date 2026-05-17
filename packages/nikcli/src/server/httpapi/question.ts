import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { Effect, Layer, Schema } from "effect"
import { Question } from "@/question"

export namespace QuestionHttpApi {
  export const Option = Schema.Struct({
    label: Schema.String,
    description: Schema.String,
  }).annotate({ identifier: "QuestionOption" })

  export const Info = Schema.Struct({
    question: Schema.String,
    header: Schema.String,
    options: Schema.Array(Option),
    multiple: Schema.optional(Schema.Boolean),
    custom: Schema.optional(Schema.Boolean),
  }).annotate({ identifier: "QuestionInfo" })

  export const Request = Schema.Struct({
    id: Schema.String,
    sessionID: Schema.String,
    questions: Schema.Array(Info),
    tool: Schema.optional(
      Schema.Struct({
        messageID: Schema.String,
        callID: Schema.String,
      }),
    ),
  }).annotate({ identifier: "QuestionRequest" })

  export const Answer = Schema.Array(Schema.String).annotate({ identifier: "QuestionAnswer" })
  export const Reply = Schema.Struct({
    answers: Schema.Array(Answer),
  }).annotate({ identifier: "QuestionReply" })

  const RequestPath = Schema.Struct({
    requestID: Schema.String,
  })

  export const Group = HttpApiGroup.make("question")
    .add(HttpApiEndpoint.get("list", "/", { success: Schema.Array(Request) }))
    .add(
      HttpApiEndpoint.post("reply", "/:requestID/reply", {
        params: RequestPath,
        payload: Reply,
        success: Schema.Boolean,
      }),
    )
    .add(
      HttpApiEndpoint.post("reject", "/:requestID/reject", {
        params: RequestPath,
        success: Schema.Boolean,
      }),
    )
    .prefix("/question")

  export const Api = HttpApi.make("nikcli").add(Group)

  export const ApiLive = HttpApiBuilder.layer(Api)

  export const handlers = {
    list: () =>
      Effect.gen(function* () {
        const question = yield* Question.Service
        return yield* question.list()
      }),
    reply: ({ params, payload }: { params: { requestID: string }; payload: typeof Reply.Type }) =>
      Effect.gen(function* () {
        const question = yield* Question.Service
        yield* question.reply({
          requestID: params.requestID,
          answers: payload.answers.map((answer) => [...answer]),
        })
        return true
      }),
    reject: ({ params }: { params: { requestID: string } }) =>
      Effect.gen(function* () {
        const question = yield* Question.Service
        yield* question.reject(params.requestID)
        return true
      }),
  }

  export const HandlersLive = HttpApiBuilder.group(Api, "question", (builder) =>
    builder.handle("list", handlers.list).handle("reply", handlers.reply).handle("reject", handlers.reject),
  )

  export const layer = ApiLive.pipe(Layer.provide(HandlersLive), Layer.provide(Question.defaultLayer))
}
