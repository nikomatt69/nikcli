import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect"
import { Identifier } from "@/id/id"
import { Log } from "@/util/log"
import { Context, Effect, Layer } from "effect"
import z from "zod"

export namespace Question {
  const log = Log.create({ service: "question" })

  export const Option = z
    .object({
      label: z.string().max(30).describe("Display text (1-5 words, concise)"),
      description: z.string().describe("Explanation of choice"),
    })
    .meta({
      ref: "QuestionOption",
    })
  export type Option = z.infer<typeof Option>

  export const Info = z
    .object({
      question: z.string().describe("Complete question"),
      header: z.string().max(30).describe("Very short label (max 30 chars)"),
      options: z.array(Option).describe("Available choices"),
      multiple: z.boolean().optional().describe("Allow selecting multiple choices"),
      custom: z.boolean().optional().describe("Allow typing a custom answer (default: true)"),
    })
    .meta({
      ref: "QuestionInfo",
    })
  export type Info = z.infer<typeof Info>

  export const Request = z
    .object({
      id: Identifier.schema("question"),
      sessionID: Identifier.schema("session"),
      questions: z.array(Info).describe("Questions to ask"),
      tool: z
        .object({
          messageID: z.string(),
          callID: z.string(),
        })
        .optional(),
    })
    .meta({
      ref: "QuestionRequest",
    })
  export type Request = z.infer<typeof Request>

  export const Answer = z.array(z.string()).meta({
    ref: "QuestionAnswer",
  })
  export type Answer = z.infer<typeof Answer>

  export const Reply = z.object({
    answers: z
      .array(Answer)
      .describe("User answers in order of questions (each answer is an array of selected labels)"),
  })
  export type Reply = z.infer<typeof Reply>

  export const Event = {
    Asked: BusEvent.define("question.asked", Request),
    Replied: BusEvent.define(
      "question.replied",
      z.object({
        sessionID: z.string(),
        requestID: z.string(),
        answers: z.array(Answer),
      }),
    ),
    Rejected: BusEvent.define(
      "question.rejected",
      z.object({
        sessionID: z.string(),
        requestID: z.string(),
      }),
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
