import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Session } from "."
import { Identifier } from "../id/id"
import { Provider } from "../provider/provider"
import { MessageV2 } from "./message-v2"
import z from "zod"
import { Token } from "../util/token"
import { Log } from "../util/log"
import { SessionProcessor } from "./processor"
import { Agent } from "@/agent/agent"
import { Plugin } from "@/plugin"
import { Config } from "@/config/config"
import { zodObject } from "@/util/effect-zod"
import { Context, Effect, Layer, Schema } from "effect"
import {
  InstanceState,
  locallyInstance,
  runPromiseWithLayer,
  withCurrentInstance,
  type InstanceContext,
} from "@/effect"
import { isOverflow as overflowCheck } from "./overflow"

export namespace SessionCompaction {
  const log = Log.create({ service: "session.compaction" })

  function agentGet(name: string) {
    return runPromiseWithLayer(
      Agent.defaultLayer,
      withCurrentInstance(
        Effect.gen(function* () {
          const agent = yield* Agent.Service
          return yield* agent.get(name)
        }),
      ),
    )
  }

  async function agentRequired(name: string) {
    const agent = await agentGet(name)
    if (!agent) throw new Error(`Agent not found: ${name}`)
    return agent
  }

  function runPlugin<A, E>(effect: Effect.Effect<A, E, Plugin.Service>) {
    return runPromiseWithLayer(Plugin.defaultLayer, withCurrentInstance(effect))
  }

  function runProvider<A, E>(effect: Effect.Effect<A, E, Provider.Service>, ctx: InstanceContext) {
    return runPromiseWithLayer(Provider.defaultLayer, locallyInstance(ctx, effect))
  }

  function runSession<A, E>(effect: Effect.Effect<A, E, Session.Service>, ctx: InstanceContext) {
    return runPromiseWithLayer(Session.defaultLayer, locallyInstance(ctx, effect))
  }

  function configGet() {
    return runPromiseWithLayer(
      Config.defaultLayer,
      withCurrentInstance(
        Effect.gen(function* () {
          const config = yield* Config.Service
          return yield* config.get()
        }),
      ),
    )
  }

  export const Event = {
    Compacted: BusEvent.define(
      "session.compacted",
      z.object({
        sessionID: z.string(),
      }),
    ),
  }

  const CreateInputSchema = Schema.Struct({
    sessionID: Schema.String.pipe(Schema.check(Schema.isStartsWith("ses"))),
    agent: Schema.String,
    model: Schema.Struct({
      providerID: Schema.String,
      modelID: Schema.String,
    }),
    auto: Schema.Boolean,
  })
  export const CreateInput = zodObject(CreateInputSchema)
  export type CreateInput = Schema.Schema.Type<typeof CreateInputSchema>

  export interface ProcessInput {
    parentID: string
    messages: MessageV2.WithParts[]
    sessionID: string
    abort: AbortSignal
    auto: boolean
  }

  export interface Interface {
    isOverflow(input: { tokens: MessageV2.Assistant["tokens"]; model: Provider.Model }): Effect.Effect<boolean, unknown>
    editContext(input: { sessionID: string; keepLastNTurns?: number }): Effect.Effect<void, unknown>
    prune(input: { sessionID: string }): Effect.Effect<void, unknown>
    process(input: ProcessInput): Effect.Effect<"continue" | "stop", unknown>
    create(input: CreateInput): Effect.Effect<void, unknown>
  }

  export class Service extends Context.Service<Service, Interface>()("SessionCompaction.Service") {}

  export const PRUNE_MINIMUM = 20_000
  export const PRUNE_PROTECT = 40_000

  const PRUNE_PROTECTED_TOOLS = ["skill"]

  // Removes tool results older than keepLastNTurns user turns regardless of size,
  // allowing the context window to stay clean for long sessions.
  async function editContextImpl(input: {
    sessionID: string
    keepLastNTurns?: number
    config: Config.Info
    ctx: InstanceContext
  }): Promise<void> {
    const config = input.config
    if (config.compaction?.prune === false) return

    const keepTurns = input.keepLastNTurns ?? 10
    const msgs = await runSession(
      Effect.gen(function* () {
        const session = yield* Session.Service
        return yield* session.messages({ sessionID: input.sessionID })
      }),
      input.ctx,
    )
    let turns = 0
    const toPrune: MessageV2.ToolPart[] = []

    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i]
      if (msg.info.role === "user") turns++
      if (turns < keepTurns) continue
      if (msg.info.role === "assistant" && (msg.info as MessageV2.Assistant).summary) break

      for (const part of msg.parts) {
        if (part.type !== "tool") continue
        if (part.state.status !== "completed") continue
        if (PRUNE_PROTECTED_TOOLS.includes(part.tool)) continue
        if (part.state.time.compacted) break
        toPrune.push(part)
      }
    }

    for (const part of toPrune) {
      if (part.state.status === "completed") {
        part.state.time.compacted = Date.now()
        await runSession(
          Effect.gen(function* () {
            const session = yield* Session.Service
            yield* session.updatePart(part)
          }),
          input.ctx,
        )
      }
    }
    log.info("editContext pruned", { count: toPrune.length })
  }

  async function pruneImpl(input: { sessionID: string; config: Config.Info; ctx: InstanceContext }) {
    const config = input.config
    if (config.compaction?.prune === false) return
    log.info("pruning")
    const msgs = await runSession(
      Effect.gen(function* () {
        const session = yield* Session.Service
        return yield* session.messages({ sessionID: input.sessionID })
      }),
      input.ctx,
    )
    let total = 0
    let pruned = 0
    const toPrune = []
    let turns = 0

    loop: for (let msgIndex = msgs.length - 1; msgIndex >= 0; msgIndex--) {
      const msg = msgs[msgIndex]
      if (msg.info.role === "user") turns++
      if (turns < 2) continue
      if (msg.info.role === "assistant" && msg.info.summary) break loop
      for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {
        const part = msg.parts[partIndex]
        if (part.type === "tool")
          if (part.state.status === "completed") {
            if (PRUNE_PROTECTED_TOOLS.includes(part.tool)) continue

            if (part.state.time.compacted) break loop
            const estimate = Token.estimate(part.state.output)
            total += estimate
            if (total > PRUNE_PROTECT) {
              pruned += estimate
              toPrune.push(part)
            }
          }
      }
    }
    log.info("found", { pruned, total })
    if (pruned > PRUNE_MINIMUM) {
      for (const part of toPrune) {
        if (part.state.status === "completed") {
          part.state.time.compacted = Date.now()
          await runSession(
            Effect.gen(function* () {
              const session = yield* Session.Service
              yield* session.updatePart(part)
            }),
            input.ctx,
          )
        }
      }
      log.info("pruned", { count: toPrune.length })
    }
  }

  async function processImpl(input: ProcessInput & { directory: string; worktree: string; ctx: InstanceContext }) {
    const userMessage = input.messages.findLast((m) => m.info.id === input.parentID)
    if (!userMessage) {
      log.error("parent message not found", { parentID: input.parentID })
      throw new Error(`Parent message not found: ${input.parentID}`)
    }
    const userMessageInfo = userMessage.info as MessageV2.User
    if (!userMessageInfo) {
      log.error("parent message info not found", { parentID: input.parentID })
      throw new Error(`Parent message info not found: ${input.parentID}`)
    }
    const agent = await agentRequired("compaction")
    const model = await runProvider(
      Effect.gen(function* () {
        const provider = yield* Provider.Service
        return agent.model
          ? yield* provider.getModel(agent.model.providerID, agent.model.modelID)
          : yield* provider.getModel(userMessageInfo.model.providerID, userMessageInfo.model.modelID)
      }),
      input.ctx,
    )
    const msg = (await runSession(
      Effect.gen(function* () {
        const session = yield* Session.Service
        return yield* session.updateMessage({
          id: Identifier.ascending("message"),
          role: "assistant",
          parentID: input.parentID,
          sessionID: input.sessionID,
          mode: "compaction",
          agent: "compaction",
          summary: true,
          path: {
            cwd: input.directory,
            root: input.worktree,
          },
          cost: 0,
          tokens: {
            output: 0,
            input: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: model.id,
          providerID: model.providerID,
          time: {
            created: Date.now(),
          },
        })
      }),
      input.ctx,
    )) as MessageV2.Assistant
    const processor = SessionProcessor.create({
      assistantMessage: msg,
      sessionID: input.sessionID,
      model,
      abort: input.abort,
    })
    const compacting = await runPlugin(
      Effect.gen(function* () {
        const plugin = yield* Plugin.Service
        return yield* plugin.trigger(
          "experimental.session.compacting",
          { sessionID: input.sessionID },
          { context: [], prompt: undefined },
        )
      }),
    )
    const defaultPrompt = `Provide a detailed prompt for continuing our conversation above.
Focus on information that would be helpful for continuing the conversation, including what we did, what we're doing, which files we're working on, and what we're going to do next.
The summary that you construct will be used so that another agent can read it and continue the work.

When constructing the summary, try to stick to this template:
---
## Goal

[What goal(s) is the user trying to accomplish?]

## Instructions

- [What important instructions did the user give you that are relevant]
- [If there is a plan or spec, include information about it so next agent can continue using it]

## Discoveries

[What notable things were learned during this conversation that would be useful for the next agent to know when continuing the work]

## Accomplished

[What work has been completed, what work is still in progress, and what work is left?]

## Relevant files / directories

[Construct a structured list of relevant files that have been read, edited, or created that pertain to the task at hand. If all the files in a directory are relevant, include the path to the directory.]
---`
    const promptText = compacting.prompt ?? [defaultPrompt, ...compacting.context].join("\n\n")
    const result = await processor.process({
      user: userMessageInfo,
      agent,
      abort: input.abort,
      sessionID: input.sessionID,
      tools: {},
      system: [],
      messages: [
        ...MessageV2.toModelMessages(input.messages, model),
        {
          role: "user",
          content: [
            {
              type: "text",
              text: promptText,
            },
          ],
        },
      ],
      model,
    })

    if (result === "continue" && input.auto) {
      await runSession(
        Effect.gen(function* () {
          const session = yield* Session.Service
          const continueMsg = yield* session.updateMessage({
            id: Identifier.ascending("message"),
            role: "user",
            sessionID: input.sessionID,
            time: {
              created: Date.now(),
            },
            agent: userMessageInfo.agent,
            model: userMessageInfo.model,
          })
          yield* session.updatePart({
            id: Identifier.ascending("part"),
            messageID: continueMsg.id,
            sessionID: input.sessionID,
            type: "text",
            synthetic: true,
            text: "Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed.",
            time: {
              start: Date.now(),
              end: Date.now(),
            },
          })
        }),
        input.ctx,
      )
    }
    if (processor.message.error) return "stop"
    Bus.publish(Event.Compacted, { sessionID: input.sessionID })
    return "continue"
  }

  async function createImpl(input: CreateInput & { ctx: InstanceContext }) {
    await runSession(
      Effect.gen(function* () {
        const session = yield* Session.Service
        const msg = yield* session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          model: input.model,
          sessionID: input.sessionID,
          agent: input.agent,
          time: {
            created: Date.now(),
          },
        })
        yield* session.updatePart({
          id: Identifier.ascending("part"),
          messageID: msg.id,
          sessionID: msg.sessionID,
          type: "compaction",
          auto: input.auto,
        })
      }),
      input.ctx,
    )
  }

  const layer = Layer.succeed(
    Service,
    Service.of({
      isOverflow: (input) =>
        Effect.gen(function* () {
          const config = yield* Effect.promise(() => configGet())
          return overflowCheck({ cfg: config, tokens: input.tokens, model: input.model })
        }),
      editContext: (input) =>
        Effect.gen(function* () {
          const ctx = yield* InstanceState.context
          const config = yield* Effect.promise(() => configGet())
          return yield* Effect.tryPromise(() => editContextImpl({ ...input, config, ctx }))
        }),
      prune: (input) =>
        Effect.gen(function* () {
          const ctx = yield* InstanceState.context
          const config = yield* Effect.promise(() => configGet())
          return yield* Effect.tryPromise(() => pruneImpl({ ...input, config, ctx }))
        }),
      process: (input) =>
        InstanceState.context.pipe(
          Effect.flatMap((ctx) =>
            Effect.tryPromise(() => processImpl({ ...input, directory: ctx.directory, worktree: ctx.worktree, ctx })),
          ),
        ),
      create: (input) =>
        InstanceState.context.pipe(Effect.flatMap((ctx) => Effect.tryPromise(() => createImpl({ ...input, ctx })))),
    }),
  )

  export const defaultLayer = layer
}
