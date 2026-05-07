import z from "zod"
import { Schema } from "effect"
import { zod } from "@/util/effect-zod"
import path from "path"
import { Tool } from "./tool"
import { Question } from "../question"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Provider } from "../provider/provider"
import { Instance } from "../project/instance"
import EXIT_DESCRIPTION from "./plan-exit.txt"
import ENTER_DESCRIPTION from "./plan-enter.txt"
import { Effect } from "effect"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"

async function getLastModel(sessionID: string) {
  for await (const item of MessageV2.stream(sessionID)) {
    if (item.info.role === "user" && item.info.model) return item.info.model
  }
  return runPromiseWithLayer(
    Provider.defaultLayer,
    withCurrentInstance(
      Effect.gen(function* () {
        const provider = yield* Provider.Service
        return yield* provider.defaultModel()
      }),
    ),
  )
}

function askQuestion(input: {
  sessionID: string
  questions: Question.Info[]
  tool?: { messageID: string; callID: string }
}) {
  return runPromiseWithLayer(
    Question.defaultLayer,
    withCurrentInstance(
      Effect.gen(function* () {
        const question = yield* Question.Service
        return yield* question.ask(input)
      }),
    ),
  )
}

function runSession<A, E>(effect: Effect.Effect<A, E, Session.Service>) {
  return runPromiseWithLayer(Session.defaultLayer, withCurrentInstance(effect))
}

export const PlanExitTool = Tool.define("plan_exit", {
  description: EXIT_DESCRIPTION,
  parameters: zod(Schema.Struct({})),
  async execute(_params, ctx) {
    const plan = await runSession(
      Effect.gen(function* () {
        const session = yield* Session.Service
        const info = yield* session.get(ctx.sessionID)
        return path.relative(Instance.worktree, yield* session.plan(info))
      }),
    )
    const answers = await askQuestion({
      sessionID: ctx.sessionID,
      questions: [
        {
          question: `Plan at ${plan} is complete. Would you like to switch to the build agent and start implementing?`,
          header: "Build Agent",
          custom: false,
          options: [
            { label: "Yes", description: "Switch to build agent and start implementing the plan" },
            { label: "No", description: "Stay with plan agent to continue refining the plan" },
          ],
        },
      ],
      tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
    })

    const answer = answers[0]?.[0]
    if (answer === "No") throw new Question.RejectedError()

    const model = await getLastModel(ctx.sessionID)

    const userMsg: MessageV2.User = {
      id: Identifier.ascending("message"),
      sessionID: ctx.sessionID,
      role: "user",
      time: {
        created: Date.now(),
      },
      agent: "build",
      model,
    }
    await runSession(
      Effect.gen(function* () {
        const session = yield* Session.Service
        yield* session.updateMessage(userMsg)
        yield* session.updatePart({
          id: Identifier.ascending("part"),
          messageID: userMsg.id,
          sessionID: ctx.sessionID,
          type: "text",
          text: `The plan at ${plan} has been approved, you can now edit files. Execute the plan`,
          synthetic: true,
        } satisfies MessageV2.TextPart)
      }),
    )

    return {
      title: "Switching to build agent",
      output: "User approved switching to build agent. Wait for further instructions.",
      metadata: {},
    }
  },
})

export const PlanEnterTool = Tool.define("plan_enter", {
  description: ENTER_DESCRIPTION,
  parameters: zod(Schema.Struct({})),
  async execute(_params, ctx) {
    const plan = await runSession(
      Effect.gen(function* () {
        const session = yield* Session.Service
        const info = yield* session.get(ctx.sessionID)
        return path.relative(Instance.worktree, yield* session.plan(info))
      }),
    )

    const answers = await askQuestion({
      sessionID: ctx.sessionID,
      questions: [
        {
          question: `Would you like to switch to the plan agent and create a plan saved to ${plan}?`,
          header: "Plan Mode",
          custom: false,
          options: [
            { label: "Yes", description: "Switch to plan agent for research and planning" },
            { label: "No", description: "Stay with build agent to continue making changes" },
          ],
        },
      ],
      tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
    })

    const answer = answers[0]?.[0]

    if (answer === "No") throw new Question.RejectedError()

    const model = await getLastModel(ctx.sessionID)

    const userMsg: MessageV2.User = {
      id: Identifier.ascending("message"),
      sessionID: ctx.sessionID,
      role: "user",
      time: {
        created: Date.now(),
      },
      agent: "plan",
      model,
    }
    await runSession(
      Effect.gen(function* () {
        const session = yield* Session.Service
        yield* session.updateMessage(userMsg)
        yield* session.updatePart({
          id: Identifier.ascending("part"),
          messageID: userMsg.id,
          sessionID: ctx.sessionID,
          type: "text",
          text: "User has requested to enter plan mode. Switch to plan mode and begin planning.",
          synthetic: true,
        } satisfies MessageV2.TextPart)
      }),
    )

    return {
      title: "Switching to plan agent",
      output: `User confirmed to switch to plan mode. A new message has been created to switch you to plan mode. The plan file will be at ${plan}. Begin planning.`,
      metadata: {},
    }
  },
})
