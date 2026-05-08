import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect"
import { Identifier } from "@/id/id"
import { Log } from "@/util/log"
import { zod, zodObject, zodObjectMode } from "@/util/effect-zod"
import { Context, Effect, Layer, Schema } from "effect"

export namespace Question {
  const log = Log.create({ service: "question" })

  const OptionSchema = Schema.Struct({
    label: Schema.String.pipe(Schema.maxLength(30)).annotations({
      description: "Display text (1-5 words, concise)",
    }),
    description: Schema.String.annotations({ description: "Explanation of choice" }),
  }).annotations({ identifier: "QuestionOption" })
  export const Option = zodObject(OptionSchema)
  export type Option = Schema.Schema.Type<typeof OptionSchema>

  const InfoSchema = Schema.Struct({
    question: Schema.String.annotations({ description: "Complete question" }),
    header: Schema.String.pipe(Schema.maxLength(30)).annotations({
      description: "Very short label (max 30 chars)",
    }),
    options: Schema.Array(OptionSchema).annotations({ description: "Available choices" }),
    multiple: Schema.optional(Schema.Boolean).annotations({ description: "Allow selecting multiple choices" }),
    custom: Schema.optional(Schema.Boolean).annotations({
      description: "Allow typing a custom answer (default: true)",
    }),
  }).annotations({ identifier: "QuestionInfo" })
  export const Info = zodObject(InfoSchema)
  export type Info = Schema.Schema.Type<typeof InfoSchema>

  const RequestSchema = Schema.Struct({
    id: Identifier.schemaEffect("question"),
    sessionID: Identifier.schemaEffect("session"),
    questions: Schema.Array(InfoSchema).annotations({ description: "Questions to ask" }),
    tool: Schema.optional(
      Schema.Struct({
        messageID: Schema.String,
        callID: Schema.String,
      }),
    ),
  }).annotations({ identifier: "QuestionRequest", ...zodObjectMode("strip") })
  export const Request = zodObject(RequestSchema)
  export type Request = Schema.Schema.Type<typeof RequestSchema>

  const AnswerSchema = Schema.Array(Schema.String).annotations({ identifier: "QuestionAnswer" })
  export const Answer = zod(AnswerSchema)
  export type Answer = Schema.Schema.Type<typeof AnswerSchema>

  const ReplySchema = Schema.Struct({
    answers: Schema.mutable(Schema.Array(AnswerSchema)).annotations({
      description: "User answers in order of questions (each answer is an array of selected labels)",
    }),
  }).annotations({ identifier: "QuestionReply", ...zodObjectMode("strip") })
  export const Reply = zodObject(ReplySchema)
  export type Reply = Schema.Schema.Type<typeof ReplySchema>

  export const Event = {
    Asked: BusEvent.define("question.asked", RequestSchema),
    Replied: BusEvent.define(
      "question.replied",
      Schema.Struct({
        sessionID: Schema.String,
        requestID: Schema.String,
        answers: Schema.mutable(Schema.Array(AnswerSchema)),
      }).annotations(zodObjectMode("strip")),
    ),
    Rejected: BusEvent.define(
      "question.rejected",
      Schema.Struct({
        sessionID: Schema.String,
        requestID: Schema.String,
      }).annotations(zodObjectMode("strip")),
    ),
  }

  type PendingEntry = {
    info: Request
    resolve: (answers: Answer[]) => void
    reject: (e: RejectedError) => void
  }

  type State = {
    pending: Record<string, PendingEntry>
  }

  export interface Interface {
    readonly ask: (input: {
      sessionID: string
      questions: Info[]
      tool?: { messageID: string; callID: string }
    }) => Effect.Effect<Answer[], RejectedError>
    readonly reply: (input: { requestID: string; answers: Answer[] }) => Effect.Effect<void>
    readonly reject: (requestID: string) => Effect.Effect<void>
    readonly list: () => Effect.Effect<Request[]>
  }

  export class Service extends Context.Tag("@nikcli/Question")<Service, Interface>() {}

  export const layer = Layer.scoped(
    Service,
    Effect.gen(function* () {
      const state = yield* InstanceState.make<State>(() =>
        Effect.succeed({
          pending: {},
        }),
      )

      const getState = () => InstanceState.get(state)

      const ask = Effect.fn("Question.ask")(function* (input: {
        sessionID: string
        questions: Info[]
        tool?: { messageID: string; callID: string }
      }) {
        const s = yield* getState()
        const id = Identifier.ascending("question")

        log.info("asking", { id, questions: input.questions.length })

        return yield* Effect.async<Answer[], RejectedError>((resume) => {
          const info: Request = {
            id,
            sessionID: input.sessionID,
            questions: input.questions,
            tool: input.tool,
          }
          s.pending[id] = {
            info,
            resolve: (answers) => resume(Effect.succeed(answers)),
            reject: (error) => resume(Effect.fail(error)),
          }
          void Bus.publish(Event.Asked, info)
          return Effect.sync(() => {
            delete s.pending[id]
          })
        })
      })

      const reply = Effect.fn("Question.reply")(function* (input: { requestID: string; answers: Answer[] }) {
        const s = yield* getState()
        const existing = s.pending[input.requestID]
        if (!existing) {
          log.warn("reply for unknown request", { requestID: input.requestID })
          return
        }
        delete s.pending[input.requestID]

        log.info("replied", { requestID: input.requestID, answers: input.answers })

        yield* Effect.promise(() =>
          Bus.publish(Event.Replied, {
            sessionID: existing.info.sessionID,
            requestID: existing.info.id,
            answers: input.answers,
          }),
        )

        existing.resolve(input.answers)
      })

      const reject = Effect.fn("Question.reject")(function* (requestID: string) {
        const s = yield* getState()
        const existing = s.pending[requestID]
        if (!existing) {
          log.warn("reject for unknown request", { requestID })
          return
        }
        delete s.pending[requestID]

        log.info("rejected", { requestID })

        yield* Effect.promise(() =>
          Bus.publish(Event.Rejected, {
            sessionID: existing.info.sessionID,
            requestID: existing.info.id,
          }),
        )

        existing.reject(new RejectedError())
      })

      const list = Effect.fn("Question.list")(function* () {
        const s = yield* getState()
        return Object.values(s.pending).map((x) => x.info)
      })

      return Service.of({
        ask,
        reply,
        reject,
        list,
      })
    }),
  )

  export const defaultLayer = layer

  export class RejectedError extends Error {
    constructor() {
      super("The user dismissed this question")
    }
  }
}
