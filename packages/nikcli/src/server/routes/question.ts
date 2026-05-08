import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import { resolver } from "hono-openapi"
import { Question } from "../../question"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { Effect, Schema } from "effect"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"
import { zod, zodObject, zodObjectMode } from "@/util/effect-zod"

const BooleanResponse = zod(Schema.Boolean)
const RequestIDParam = zodObject(
  Schema.Struct({
    requestID: Schema.String,
  }).annotations(zodObjectMode("strip")),
)

function runQuestion<A, E>(effect: Effect.Effect<A, E, Question.Service>) {
  return runPromiseWithLayer(Question.defaultLayer, withCurrentInstance(effect))
}

export const QuestionRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List pending questions",
        description: "Get all pending question requests across all sessions.",
        operationId: "question.list",
        responses: {
          200: {
            description: "List of pending questions",
            content: {
              "application/json": {
                schema: resolver(Question.Request.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const questions = await runQuestion(
          Effect.gen(function* () {
            const question = yield* Question.Service
            return yield* question.list()
          }),
        )
        return c.json(questions)
      },
    )
    .post(
      "/:requestID/reply",
      describeRoute({
        summary: "Reply to question request",
        description: "Provide answers to a question request from the AI assistant.",
        operationId: "question.reply",
        responses: {
          200: {
            description: "Question answered successfully",
            content: {
              "application/json": {
                schema: resolver(BooleanResponse),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        RequestIDParam,
      ),
      validator("json", Question.Reply),
      async (c) => {
        const params = c.req.valid("param")
        const json = c.req.valid("json")
        await runQuestion(
          Effect.gen(function* () {
            const question = yield* Question.Service
            yield* question.reply({
              requestID: params.requestID,
              answers: json.answers,
            })
          }),
        )
        return c.json(true)
      },
    )
    .post(
      "/:requestID/reject",
      describeRoute({
        summary: "Reject question request",
        description: "Reject a question request from the AI assistant.",
        operationId: "question.reject",
        responses: {
          200: {
            description: "Question rejected successfully",
            content: {
              "application/json": {
                schema: resolver(BooleanResponse),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        RequestIDParam,
      ),
      async (c) => {
        const params = c.req.valid("param")
        await runQuestion(
          Effect.gen(function* () {
            const question = yield* Question.Service
            yield* question.reject(params.requestID)
          }),
        )
        return c.json(true)
      },
    ),
)
