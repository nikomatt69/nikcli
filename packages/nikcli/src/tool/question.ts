import { Effect, Schema } from "effect"
import { zod } from "@nikcli-ai/util/effect-zod"
import { Tool } from "./tool"
import { Question } from "../question"
import DESCRIPTION from "./question.txt"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"

const QuestionWithoutCustom = Schema.Struct({
  question: Schema.String.annotate({ description: "Complete question" }),
  header: Schema.String.pipe(Schema.check(Schema.isMaxLength(30))).annotate({
    description: "Very short label (max 30 chars)",
  }),
  options: Schema.Array(
    Schema.Struct({
      label: Schema.String.pipe(Schema.check(Schema.isMaxLength(30))).annotate({
        description: "Display text (1-5 words, concise)",
      }),
      description: Schema.String.annotate({ description: "Explanation of choice" }),
    }),
  ).annotate({ description: "Available choices" }),
  multiple: Schema.optional(Schema.Boolean).annotate({ description: "Allow selecting multiple choices" }),
})

const Parameters = Schema.Struct({
  questions: Schema.Array(QuestionWithoutCustom).annotate({ description: "Questions to ask" }),
})

export const QuestionTool = Tool.define("question", {
  description: DESCRIPTION,
  parameters: zod(Parameters),
  async execute(params, ctx) {
    const answers = await runPromiseWithLayer(
      Question.defaultLayer,
      withCurrentInstance(
        Effect.gen(function* () {
          const question = yield* Question.Service
          return yield* question.ask({
            sessionID: ctx.sessionID,
            questions: [...params.questions] as Question.Info[],
            tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
          })
        }),
      ),
    )

    function format(answer: Question.Answer | undefined) {
      if (!answer?.length) return "Unanswered"
      return answer.join(", ")
    }

    const formatted = params.questions.map((q, i) => `"${q.question}"="${format(answers[i])}"`).join(", ")

    return {
      title: `Asked ${params.questions.length} question${params.questions.length > 1 ? "s" : ""}`,
      output: `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`,
      metadata: {
        answers,
      },
    }
  },
})
