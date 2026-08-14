import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect"
import { Identifier } from "@nikcli-ai/util/id"
import { Log } from "@nikcli-ai/util/log"
import { zod, zodObject, zodObjectMode, type DeepMutable } from "@nikcli-ai/util/effect-zod"
import { Context, Effect, Layer, Schema } from "effect"
import { isDeepEqual } from "remeda"
import z from "zod"

export namespace Question {
  const log = Log.create({ service: "question" })

  const OptionSchema = Schema.Struct({
    label: Schema.String.pipe(Schema.check(Schema.isMaxLength(30))).annotate({
      description: "Display text (1-5 words, concise)",
    }),
    description: Schema.String.annotate({
      description: "Explanation of choice",
    }),
  }).annotate({ identifier: "QuestionOption" })
  export const Option = zodObject(OptionSchema)
  export type Option = Schema.Schema.Type<typeof OptionSchema>

  const InfoSchema = Schema.Struct({
    question: Schema.String.annotate({ description: "Complete question" }),
    header: Schema.String.pipe(Schema.check(Schema.isMaxLength(30))).annotate({
      description: "Very short label (max 30 chars)",
    }),
    options: Schema.Array(OptionSchema).annotate({
      description: "Available choices",
    }),
    multiple: Schema.optional(Schema.Boolean).annotate({
      description: "Allow selecting multiple choices",
    }),
    custom: Schema.optional(Schema.Boolean).annotate({
      description: "Allow typing a custom answer (default: true)",
    }),
  }).annotate({ identifier: "QuestionInfo" })
  export const Info = zodObject(InfoSchema)
  export type Info = DeepMutable<Schema.Schema.Type<typeof InfoSchema>>

  export const RequestSchema = Schema.Struct({
    id: Identifier.schemaEffect("question"),
    sessionID: Identifier.schemaEffect("session"),
    questions: Schema.Array(InfoSchema).annotate({
      description: "Questions to ask",
    }),
    tool: Schema.optional(
      Schema.Struct({
        messageID: Schema.String,
        callID: Schema.String,
      }).annotate(zodObjectMode("strip")),
    ),
  }).annotate({ ...zodObjectMode("strip"), identifier: "QuestionRequest" })
  export const Request = zodObject(RequestSchema)
  export type Request = DeepMutable<Schema.Schema.Type<typeof RequestSchema>>

  const AnswerSchema = Schema.Array(Schema.String).annotate({
    identifier: "QuestionAnswer",
  })
  export const Answer = zod(AnswerSchema)
  export type Answer = DeepMutable<Schema.Schema.Type<typeof AnswerSchema>>

  export const Reply = z.object({
    answers: z
      .array(Answer)
      .describe("User answers in order of questions (each answer is an array of selected labels)"),
  })
  export type Reply = z.infer<typeof Reply>

  export const Event = {
    Asked: BusEvent.schema("question.asked", RequestSchema),
    Replied: BusEvent.schema(
      "question.replied",
      Schema.Struct({
        sessionID: Schema.String,
        requestID: Schema.String,
        answers: Schema.Array(AnswerSchema),
      }),
    ),
    Rejected: BusEvent.schema(
      "question.rejected",
      Schema.Struct({
        sessionID: Schema.String,
        requestID: Schema.String,
      }),
    ),
  }

  type Waiter = {
    resolve: (answers: Answer[]) => void
    reject: (e: RejectedError) => void
  }

  type PendingEntry = {
    info: Request
    state: "pending" | "settling"
    waiters: Map<symbol, Waiter>
  }

  type State = {
    pending: Record<string, PendingEntry>
  }

  export type AskInput = {
    id?: string
    sessionID: string
    questions: Info[]
    tool?: { messageID: string; callID: string }
  }

  export interface Interface {
    readonly ask: (input: AskInput) => Effect.Effect<Answer[], RejectedError | AlreadyExistsError | InvalidIDError>
    readonly reply: (input: { requestID: string; answers: Answer[] }) => Effect.Effect<void>
    readonly reject: (requestID: string) => Effect.Effect<void>
    readonly list: () => Effect.Effect<Request[]>
  }

  export class Service extends Context.Service<Service, Interface>()("@nikcli/Question") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const state = yield* InstanceState.make<State>(() =>
        Effect.succeed({
          pending: {},
        }),
      )

      const getState = () => InstanceState.get(state)

      const ask = Effect.fn("Question.ask")(function* (input: AskInput) {
        if (input.id !== undefined && !input.id.startsWith("que_")) {
          return yield* Effect.fail(new InvalidIDError({ id: input.id }))
        }
        const s = yield* getState()
        const id = Identifier.ascending("question", input.id)
        const info = makeRequest(input, id)

        return yield* Effect.callback<Answer[], RejectedError | AlreadyExistsError>((resume) => {
          const waiterID = Symbol(id)
          const waiter: Waiter = {
            resolve: (answers) => resume(Effect.succeed(answers)),
            reject: (error) => resume(Effect.fail(error)),
          }
          const existing = s.pending[id]
          if (existing) {
            if (existing.state !== "pending" || input.id === undefined || !isDeepEqual(existing.info, info)) {
              resume(Effect.fail(new AlreadyExistsError({ id })))
              return
            }
            existing.waiters.set(waiterID, waiter)
          } else {
            log.info("asking", { id, questions: input.questions.length })
            s.pending[id] = {
              info,
              state: "pending",
              waiters: new Map([[waiterID, waiter]]),
            }
            void Bus.publish(Event.Asked, info)
          }

          return Effect.sync(() => {
            const current = s.pending[id]
            if (!current || current.state !== "pending") return
            current.waiters.delete(waiterID)
            if (current.waiters.size > 0) return
            current.state = "settling"
            void Bus.publish(Event.Rejected, {
              sessionID: current.info.sessionID,
              requestID: current.info.id,
            }).finally(() => {
              if (s.pending[id] === current) delete s.pending[id]
            })
          })
        })
      })

      const reply = Effect.fn("Question.reply")(function* (input: { requestID: string; answers: Answer[] }) {
        const s = yield* getState()
        const existing = s.pending[input.requestID]
        if (!existing || existing.state !== "pending") {
          log.warn("reply for unknown request", { requestID: input.requestID })
          return
        }
        existing.state = "settling"

        log.info("replied", {
          requestID: input.requestID,
          answers: input.answers,
        })

        yield* Effect.promise(() =>
          Bus.publish(Event.Replied, {
            sessionID: existing.info.sessionID,
            requestID: existing.info.id,
            answers: input.answers,
          }),
        ).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (s.pending[input.requestID] === existing) delete s.pending[input.requestID]
              for (const waiter of existing.waiters.values()) waiter.resolve(input.answers)
            }),
          ),
        )
      })

      const reject = Effect.fn("Question.reject")(function* (requestID: string) {
        const s = yield* getState()
        const existing = s.pending[requestID]
        if (!existing || existing.state !== "pending") {
          log.warn("reject for unknown request", { requestID })
          return
        }
        existing.state = "settling"

        log.info("rejected", { requestID })

        yield* Effect.promise(() =>
          Bus.publish(Event.Rejected, {
            sessionID: existing.info.sessionID,
            requestID: existing.info.id,
          }),
        ).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (s.pending[requestID] === existing) delete s.pending[requestID]
              for (const waiter of existing.waiters.values()) waiter.reject(new RejectedError({}))
            }),
          ),
        )
      })

      const list = Effect.fn("Question.list")(function* () {
        const s = yield* getState()
        return Object.values(s.pending).flatMap((entry) => (entry.state === "pending" ? [entry.info] : []))
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

  export class RejectedError extends Schema.TaggedErrorClass<RejectedError>()("QuestionRejectedError", {}) {
    override get message() {
      return "The user dismissed this question"
    }
  }

  export class AlreadyExistsError extends Schema.TaggedErrorClass<AlreadyExistsError>()("QuestionAlreadyExistsError", {
    id: Schema.String,
  }) {
    override get message() {
      return `A different question request already exists with id ${this.id}`
    }
  }

  export class InvalidIDError extends Schema.TaggedErrorClass<InvalidIDError>()("QuestionInvalidIDError", {
    id: Schema.String,
  }) {
    override get message() {
      return `Question id must start with que_: ${this.id}`
    }
  }

  function makeRequest(input: AskInput, id: string): Request {
    return {
      id,
      sessionID: input.sessionID,
      questions: structuredClone(input.questions),
      ...(input.tool === undefined ? {} : { tool: { ...input.tool } }),
    }
  }
}
