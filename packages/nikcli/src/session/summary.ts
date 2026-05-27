import { Provider } from "@/provider/provider"
import { Session } from "."
import { MessageV2 } from "./message-v2"
import { Snapshot } from "@/snapshot"
import { Log } from "@/util/log"
import path from "path"
import { Storage } from "@/storage/storage"
import { Bus } from "@/bus"
import { LLM } from "./llm"
import { Agent } from "@/agent/agent"
import { zodObject } from "@/util/effect-zod"
import { Context, Effect, Layer, Schema } from "effect"
import { InstanceState, locallyInstance, runPromiseWithLayer, type InstanceContext } from "@/effect"

export namespace SessionSummary {
  const log = Log.create({ service: "session.summary" })

  const SummarizeInputSchema = Schema.Struct({
    sessionID: Schema.String,
    messageID: Schema.String,
  })
  export const SummarizeInput = zodObject(SummarizeInputSchema)
  export type SummarizeInput = Schema.Schema.Type<typeof SummarizeInputSchema>

  const DiffInputSchema = Schema.Struct({
    sessionID: Schema.String.pipe(Schema.check(Schema.isStartsWith("ses"))),
    messageID: Schema.optional(Schema.String.pipe(Schema.check(Schema.isStartsWith("msg")))),
  })
  export const DiffInput = zodObject(DiffInputSchema)
  export type DiffInput = Schema.Schema.Type<typeof DiffInputSchema>

  export interface Interface {
    summarize(input: SummarizeInput): Effect.Effect<void, unknown>
    diff(input: DiffInput): Effect.Effect<Snapshot.FileDiff[], unknown>
    computeDiff(input: { messages: MessageV2.WithParts[] }): Effect.Effect<Snapshot.FileDiff[], unknown>
  }

  export class Service extends Context.Service<Service, Interface>()("SessionSummary.Service") {}

  function runStorage<A, E>(effect: Effect.Effect<A, E, Storage.Service>) {
    return runPromiseWithLayer(Storage.defaultLayer, effect)
  }

  function runProvider<A, E>(effect: Effect.Effect<A, E, Provider.Service>, ctx: InstanceContext) {
    return runPromiseWithLayer(Provider.defaultLayer, locallyInstance(ctx, effect))
  }

  function runSession<A, E>(effect: Effect.Effect<A, E, Session.Service>, ctx: InstanceContext) {
    return runPromiseWithLayer(Session.defaultLayer, locallyInstance(ctx, effect))
  }

  function storageRead<T>(key: string[]) {
    return runStorage(
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        return yield* storage.read<T>(key)
      }),
    )
  }

  function storageWrite<T>(key: string[], content: T) {
    return runStorage(
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        yield* storage.write(key, content)
      }),
    )
  }

  async function messagesForSummary(ctx: InstanceContext, input: { sessionID: string; messageID: string }) {
    const all = await runSession(
      Effect.gen(function* () {
        const session = yield* Session.Service
        return yield* session.messages({ sessionID: input.sessionID })
      }),
      ctx,
    )
    const anchor = all.find((message) => message.info.id === input.messageID)
    if (!anchor) {
      return {
        all,
        focus: [] as MessageV2.WithParts[],
        rootID: input.messageID,
      }
    }

    const rootID = anchor.info.role === "assistant" ? anchor.info.parentID : anchor.info.id
    return {
      all,
      rootID,
      focus: all.filter(
        (message) =>
          message.info.id === rootID || (message.info.role === "assistant" && message.info.parentID === rootID),
      ),
    }
  }

  const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const snapshot = yield* Snapshot.Service
      const agentService = yield* Agent.Service

      const computeDiff = (input: { messages: MessageV2.WithParts[] }) =>
        Effect.gen(function* () {
          let from: string | undefined
          let to: string | undefined

          for (const item of input.messages) {
            if (!from) {
              for (const part of item.parts) {
                if (part.type === "step-start" && part.snapshot) {
                  from = part.snapshot
                  break
                }
              }
            }

            for (const part of item.parts) {
              if (part.type === "step-finish" && part.snapshot) {
                to = part.snapshot
                break
              }
            }
          }

          if (from && to) {
            return yield* snapshot.diffFull(from, to)
          }
          return []
        })

      async function summarizeSession(
        ctx: InstanceContext,
        input: { sessionID: string; messages: MessageV2.WithParts[] },
      ) {
        const files = new Set(
          input.messages
            .flatMap((x) => x.parts)
            .filter((x) => x.type === "patch")
            .flatMap((x) => x.files)
            .map((x) => path.relative(ctx.worktree, x)),
        )
        const diffs = (await Effect.runPromise(computeDiff({ messages: input.messages }))).filter((x) => {
          return files.has(x.file)
        })
        await runSession(
          Effect.gen(function* () {
            const session = yield* Session.Service
            yield* session.update(input.sessionID, (draft) => {
              draft.summary = {
                additions: diffs.reduce((sum, x) => sum + x.additions, 0),
                deletions: diffs.reduce((sum, x) => sum + x.deletions, 0),
                files: diffs.length,
              }
            })
          }),
          ctx,
        )
        await storageWrite(["session_diff", input.sessionID], diffs)
        await Bus.publish(Session.Event.Diff, {
          sessionID: input.sessionID,
          diff: diffs,
        })
      }

      async function summarizeMessage(
        ctx: InstanceContext,
        input: { messageID: string; messages: MessageV2.WithParts[] },
      ) {
        const anchor = input.messages.find((message) => message.info.id === input.messageID)
        if (!anchor) return
        const rootID = anchor.info.role === "assistant" ? anchor.info.parentID : anchor.info.id
        const messages = input.messages.filter(
          (message) =>
            message.info.id === rootID || (message.info.role === "assistant" && message.info.parentID === rootID),
        )
        const msgWithParts = messages.find((message) => message.info.id === rootID)
        if (!msgWithParts || msgWithParts.info.role !== "user") return
        const userMsg = msgWithParts.info as MessageV2.User
        const diffs = await Effect.runPromise(computeDiff({ messages }))
        userMsg.summary = {
          ...userMsg.summary,
          diffs,
        }
        await runSession(
          Effect.gen(function* () {
            const session = yield* Session.Service
            yield* session.updateMessage(userMsg)
          }),
          ctx,
        )

        const textPart = msgWithParts.parts.find((p) => p.type === "text" && !p.synthetic) as MessageV2.TextPart
        if (textPart && userMsg.summary?.title === undefined) {
          const agent = await Effect.runPromise(agentService.get("title"))
          if (!agent) return
          const model = await runProvider(
            Effect.gen(function* () {
              const provider = yield* Provider.Service
              if (agent.model) return yield* provider.getModel(agent.model.providerID, agent.model.modelID)
              return (
                (yield* provider.getSmallModel(userMsg.model.providerID)) ??
                (yield* provider.getModel(userMsg.model.providerID, userMsg.model.modelID))
              )
            }),
            ctx,
          )
          const stream = await LLM.stream({
            agent,
            user: userMsg,
            tools: {},
            model,
            small: true,
            messages: [
              {
                role: "user" as const,
                content: `
                  The following is the text to summarize:
                  <text>
                  ${textPart?.text ?? ""}
                  </text>
                `,
              },
            ],
            abort: new AbortController().signal,
            sessionID: userMsg.sessionID,
            system: [],
            retries: 3,
          })
          const result = await stream.text.catch((error) => {
            log.error("failed to generate title", { error })
            return undefined
          })
          if (!result?.trim()) return
          log.info("title", { title: result })
          userMsg.summary.title = result
          await runSession(
            Effect.gen(function* () {
              const session = yield* Session.Service
              yield* session.updateMessage(userMsg)
            }),
            ctx,
          )
        }
      }

      return Service.of({
        summarize: (input) =>
          InstanceState.context.pipe(
            Effect.flatMap((ctx) =>
              Effect.tryPromise(async () => {
                const all = await runSession(
                  Effect.gen(function* () {
                    const session = yield* Session.Service
                    return yield* session.messages({ sessionID: input.sessionID })
                  }),
                  ctx,
                )
                await Promise.all([
                  summarizeSession(ctx, { sessionID: input.sessionID, messages: all }),
                  summarizeMessage(ctx, { messageID: input.messageID, messages: all }),
                ])
              }),
            ),
          ),
        diff: (input) =>
          Effect.gen(function* () {
            if (!input.messageID) {
              return yield* Effect.promise(() =>
                storageRead<Snapshot.FileDiff[]>(["session_diff", input.sessionID]).catch(() => []),
              )
            }

            const ctx = yield* InstanceState.context
            const { focus, rootID } = yield* Effect.tryPromise(() =>
              messagesForSummary(ctx, {
                sessionID: input.sessionID,
                messageID: input.messageID!,
              }),
            )
            const root = focus.find((message) => message.info.id === rootID)
            if (root?.info.role === "user" && root.info.summary?.diffs) {
              return root.info.summary.diffs
            }
            if (!focus.length) return []
            return yield* computeDiff({ messages: focus })
          }),
        computeDiff,
      })
    }),
  )

  export const defaultLayer = Layer.unwrap(
    Effect.sync(() => layer.pipe(Layer.provide(Layer.mergeAll(Snapshot.defaultLayer, Agent.defaultLayer)))),
  )
}
