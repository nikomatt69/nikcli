import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
} from "@effect/platform"
import { Effect, Layer, Schema } from "effect"
import { Question } from "@/question"

export namespace QuestionHttpApi {
  export const Option = Schema.Struct({
    label: Schema.String,
    description: Schema.String,
  }).annotations({ identifier: "QuestionOption" })

  export const Info = Schema.Struct({
    question: Schema.String,
    header: Schema.String,
    options: Schema.Array(Option),
    multiple: Schema.optional(Schema.Boolean),
    custom: Schema.optional(Schema.Boolean),
  }).annotations({ identifier: "QuestionInfo" })

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
  }).annotations({ identifier: "QuestionRequest" })

  export const Answer = Schema.Array(Schema.String).annotations({ identifier: "QuestionAnswer" })
  export const Reply = Schema.Struct({
    answers: Schema.Array(Answer),
  }).annotations({ identifier: "QuestionReply" })

  const RequestPath = Schema.Struct({
    requestID: Schema.String,
  })

  export const Group = HttpApiGroup.make("question")
    .add(HttpApiEndpoint.get("list", "/").addSuccess(Schema.Array(Request)))
    .add(
      HttpApiEndpoint.post("reply", "/:requestID/reply")
        .setPath(RequestPath)
        .setPayload(Reply)
        .addSuccess(Schema.Boolean),
    )
    .add(
      HttpApiEndpoint.post("reject", "/:requestID/reject")
        .setPath(RequestPath)
        .addSuccess(Schema.Boolean),
    )
    .prefix("/question")

  export const Api = HttpApi.make("nikcli").add(Group)

  export const ApiLive = HttpApiBuilder.api(Api)

  export const handlers = {
    list: () =>
      Effect.gen(function* () {
        const question = yield* Question.Service
        return yield* question.list()
      }),
    reply: ({ path, payload }: { path: { requestID: string }; payload: typeof Reply.Type }) =>
      Effect.gen(function* () {
        const question = yield* Question.Service
        yield* question.reply({
          requestID: path.requestID,
          answers: payload.answers.map((answer) => [...answer]),
        })
        return true
      }),
    reject: ({ path }: { path: { requestID: string } }) =>
      Effect.gen(function* () {
        const question = yield* Question.Service
        yield* question.reject(path.requestID)
        return true
      }),
  }

  export const HandlersLive = HttpApiBuilder.group(Api, "question", (builder) =>
    builder
      .handle("list", handlers.list)
      .handle("reply", handlers.reply)
      .handle("reject", handlers.reject),
  )

  export const layer = ApiLive.pipe(
    Layer.provide(HandlersLive),
    Layer.provide(Question.defaultLayer),
  )
}
