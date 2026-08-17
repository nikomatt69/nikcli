import { describe, expect, it } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { withIsolatedDatabase } from "../helpers/sqlite"

async function withSession(
  fn: (input: {
    sessionID: string
    directory: string
    runPrompt: <A, E>(effect: Effect.Effect<A, E, any>) => Promise<A>
    runSession: <A, E>(effect: Effect.Effect<A, E, any>) => Promise<A>
  }) => Promise<void>,
) {
  await withIsolatedDatabase(async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-pending-input-"))
    const [{ Instance }, { Session }, { SessionPrompt }, effect] = await Promise.all([
      import("@/project/instance"),
      import("@/session"),
      import("@/session/prompt"),
      import("@/effect"),
    ])

    try {
      await Instance.provide({
        directory,
        fn: async () => {
          const runSession = <A, E>(value: Effect.Effect<A, E, any>) =>
            effect.runPromiseWithLayer(Session.defaultLayer, effect.withCurrentInstance(value))
          const runPrompt = <A, E>(value: Effect.Effect<A, E, any>) =>
            effect.runPromiseWithLayer(SessionPrompt.defaultLayer, effect.withCurrentInstance(value))
          const session = await runSession(
            Effect.gen(function* () {
              const service = yield* Session.Service
              return yield* service.createNext({
                directory,
                title: "pending input test",
              })
            }),
          )
          await fn({ sessionID: session.id, directory, runPrompt, runSession })
        },
      })
    } finally {
      await Instance.disposeAll().catch(() => undefined)
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
}

const promptInput = (sessionID: string, messageID: string, text: string) => ({
  sessionID,
  messageID,
  agent: "build",
  model: { providerID: "test", modelID: "test" },
  noReply: true,
  parts: [{ type: "text" as const, text }],
})

describe.serial("durable pending input", () => {
  it("keeps busy input out of history and reconciles retries", async () => {
    await withSession(async ({ sessionID, runPrompt, runSession }) => {
      const [{ Identifier }, { MessageRepo }, { SessionPending }, { PromptState }, { Session }, { SessionPrompt }] =
        await Promise.all([
          import("@nikcli-ai/util/id"),
          import("@/session/message-repo"),
          import("@/session/pending"),
          import("@/session/prompt-state"),
          import("@/session"),
          import("@/session/prompt"),
        ])
      const messageID = Identifier.ascending("message")
      const controller = PromptState.reserve(sessionID)
      expect(controller).toBeDefined()

      const first = await runPrompt(
        Effect.gen(function* () {
          const prompt = yield* SessionPrompt.Service
          return yield* prompt.admit(promptInput(sessionID, messageID, "queued"))
        }),
      )
      expect(first.pending?.messageID).toBe(messageID)
      expect(first.pending?.delivery).toBe("queue")
      expect(MessageRepo.getMessageWithParts(sessionID, messageID)).toBeUndefined()
      expect(SessionPending.list(sessionID)).toHaveLength(1)

      const retry = await runPrompt(
        Effect.gen(function* () {
          const prompt = yield* SessionPrompt.Service
          return yield* prompt.admit(promptInput(sessionID, messageID, "queued"))
        }),
      )
      expect(retry.retry).toBe(true)
      expect(retry.pending?.id).toBe(first.pending?.id)

      const steered = await runPrompt(
        Effect.gen(function* () {
          const prompt = yield* SessionPrompt.Service
          return yield* prompt.steerPending({
            sessionID,
            pendingID: first.pending!.id,
          })
        }),
      )
      expect(steered.delivery).toBe("steer")
      expect(SessionPending.list(sessionID)[0]?.delivery).toBe("steer")

      await expect(
        runPrompt(
          Effect.gen(function* () {
            const prompt = yield* SessionPrompt.Service
            return yield* prompt.admit(promptInput(sessionID, messageID, "different"))
          }),
        ),
      ).rejects.toMatchObject({ name: "SessionPendingConflictError" })

      const batchIDs = [Identifier.ascending("message"), Identifier.ascending("message")]
      const batch = batchIDs.map((id) => ({
        info: {
          id,
          role: "user" as const,
          sessionID,
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "test", modelID: "test" },
        },
        parts: [],
      }))
      const firstReply = PromptState.wait(sessionID, batchIDs[0])
      const secondReply = PromptState.wait(sessionID, batchIDs[1])
      const promotion = PromptState.wait(sessionID, batchIDs[0], "promotion")
      PromptState.promoted(sessionID, batch)
      expect((await promotion).info.id).toBe(batchIDs[0])

      const assistant = {
        info: {
          id: Identifier.ascending("message"),
          role: "assistant" as const,
          sessionID,
          parentID: batchIDs[1],
          modelID: "test",
          providerID: "test",
          mode: "build",
          agent: "build",
          path: { cwd: "", root: "" },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          time: { created: Date.now(), completed: Date.now() },
          finish: "stop",
        },
        parts: [],
      }
      PromptState.resolve(sessionID, assistant)
      expect((await firstReply).info.id).toBe(assistant.info.id)
      expect((await secondReply).info.id).toBe(assistant.info.id)

      let interruptedError: unknown
      const interrupted = PromptState.wait(sessionID, Identifier.ascending("message")).catch((error) => {
        interruptedError = error
      })
      await PromptState.cancel(sessionID)
      await interrupted
      expect(interruptedError).toMatchObject({ name: "MessageAbortedError" })
      await PromptState.finish(sessionID, controller!)
      await runSession(
        Effect.gen(function* () {
          const session = yield* Session.Service
          yield* session.remove(sessionID)
        }),
      )
      expect(SessionPending.list(sessionID)).toEqual([])
    })
  }, 20_000)

  it("promotes idle input immediately and retains identity", async () => {
    await withSession(async ({ sessionID, runPrompt }) => {
      const [{ Identifier }, { MessageRepo }, { SessionPending }, { SessionPrompt }] = await Promise.all([
        import("@nikcli-ai/util/id"),
        import("@/session/message-repo"),
        import("@/session/pending"),
        import("@/session/prompt"),
      ])
      const messageID = Identifier.ascending("message")
      const input = promptInput(sessionID, messageID, "immediate")

      const first = await runPrompt(
        Effect.gen(function* () {
          const prompt = yield* SessionPrompt.Service
          return yield* prompt.admit(input)
        }),
      )
      expect(first.message?.info.id).toBe(messageID)
      expect(SessionPending.list(sessionID)).toEqual([])
      expect(MessageRepo.getMessageWithParts(sessionID, messageID)?.parts).toHaveLength(1)
      expect(MessageRepo.getPromptData(sessionID, messageID)).toBe(SessionPending.canonical(input))

      const retry = await runPrompt(
        Effect.gen(function* () {
          const prompt = yield* SessionPrompt.Service
          return yield* prompt.admit(input)
        }),
      )
      expect(retry.retry).toBe(true)
      expect(MessageRepo.listMessages(sessionID).filter((message) => message.id === messageID)).toHaveLength(1)
    })
  }, 20_000)

  it("keeps explicit queue delivery while the session is busy", async () => {
    await withSession(async ({ sessionID, runPrompt }) => {
      const [{ Identifier }, { MessageRepo }, { SessionPending }, { PromptState }, { SessionPrompt }] =
        await Promise.all([
          import("@nikcli-ai/util/id"),
          import("@/session/message-repo"),
          import("@/session/pending"),
          import("@/session/prompt-state"),
          import("@/session/prompt"),
        ])
      const messageID = Identifier.ascending("message")
      const controller = PromptState.reserve(sessionID)
      expect(controller).toBeDefined()

      const queued = await runPrompt(
        Effect.gen(function* () {
          const prompt = yield* SessionPrompt.Service
          return yield* prompt.admit({
            ...promptInput(sessionID, messageID, "later"),
            delivery: "queue",
          })
        }),
      )
      expect(queued.pending?.delivery).toBe("queue")
      expect(MessageRepo.getMessageWithParts(sessionID, messageID)).toBeUndefined()
      expect(SessionPending.list(sessionID, "queue")).toHaveLength(1)
      expect(SessionPending.list(sessionID, "steer")).toHaveLength(0)

      await PromptState.finish(sessionID, controller!)
    })
  }, 20_000)

  it("waitUntilIdle resolves once the prompt owner finishes", async () => {
    await withSession(async ({ sessionID }) => {
      const { PromptState } = await import("@/session/prompt-state")
      const controller = PromptState.reserve(sessionID)
      expect(controller).toBeDefined()
      const idle = PromptState.waitUntilIdle(sessionID)
      await PromptState.finish(sessionID, controller!)
      await idle
      expect(PromptState.owned(sessionID)).toBe(false)
    })
  }, 20_000)

  it("steer admission interrupts busy input and persists immediately", async () => {
    await withSession(async ({ sessionID, runPrompt }) => {
      const [{ Identifier }, { MessageRepo }, { SessionPending }, { PromptState }, { SessionPrompt }] =
        await Promise.all([
          import("@nikcli-ai/util/id"),
          import("@/session/message-repo"),
          import("@/session/pending"),
          import("@/session/prompt-state"),
          import("@/session/prompt"),
        ])
      const queuedID = Identifier.ascending("message")
      const steerID = Identifier.ascending("message")
      const controller = PromptState.reserve(sessionID)
      expect(controller).toBeDefined()

      const queued = await runPrompt(
        Effect.gen(function* () {
          const prompt = yield* SessionPrompt.Service
          return yield* prompt.admit(promptInput(sessionID, queuedID, "later"))
        }),
      )
      expect(queued.pending?.delivery).toBe("queue")

      const steered = await runPrompt(
        Effect.gen(function* () {
          const prompt = yield* SessionPrompt.Service
          return yield* prompt.admit({
            ...promptInput(sessionID, steerID, "now"),
            delivery: "steer",
          })
        }),
      )
      expect(steered.message?.info.id).toBe(steerID)
      expect(MessageRepo.getMessageWithParts(sessionID, steerID)).toBeDefined()
      expect(SessionPending.list(sessionID, "queue")).toHaveLength(1)
      expect(PromptState.owned(sessionID)).toBe(false)
    })
  }, 20_000)
})
