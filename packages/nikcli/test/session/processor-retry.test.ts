import { afterAll, describe, expect, it, mock } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-processor-retry-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

let streamAttempt = 0
mock.module("@/session/llm", () => ({
  LLM: {
    stream: async () => {
      streamAttempt++
      return {
        fullStream: (async function* () {
          if (streamAttempt === 1) {
            yield { type: "reasoning-start", id: "reasoning-1" }
            yield { type: "reasoning-delta", id: "reasoning-1", text: "partial reasoning" }
            throw new Error("transient failure")
          }
          throw new DOMException("Interrupted", "AbortError")
        })(),
      }
    },
  },
}))
mock.module("@/session/retry", () => ({
  SessionRetry: {
    RETRY_MAX_ATTEMPTS: 3,
    delay: () => 0,
    retryable: () => "Temporary provider failure",
    sleep: async () => {},
  },
}))

const [{ SessionProcessor }, { Session }, { locallyInstance }, { Identifier }, { Bus }, { MessageV2 }, { Instance }, { Effect }] =
  await Promise.all([
    import("@/session/processor"),
    import("@/session"),
    import("@/effect"),
    import("@/id/id"),
    import("@/bus"),
    import("@/session/message-v2"),
    import("@/project/instance"),
    import("effect"),
  ])

afterAll(async () => {
  await fs.rm(testHome, { recursive: true, force: true })
})

describe("SessionProcessor retry cleanup", () => {
  it("does not republish or flush interrupted reasoning removed for retry", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-processor-retry-"))
    const project = { id: `project-${path.basename(directory)}`, vcs: true } as any
    const events: Array<{ type: "updated" | "removed"; partID: string }> = []

    try {
      await Instance.provide({
        directory,
        fn: async () => {
          const unsubscribeUpdate = Bus.subscribe(MessageV2.Event.PartUpdated, (event) =>
            events.push({ type: "updated", partID: event.properties.part.id }),
          )
          const unsubscribeRemove = Bus.subscribe(MessageV2.Event.PartRemoved, (event) =>
            events.push({ type: "removed", partID: event.properties.partID }),
          )
          try {
            await Effect.runPromise(
              locallyInstance(
                { directory, worktree: directory, project },
                Effect.gen(function* () {
                  const session = yield* Session.Service
                  const created = yield* session.createNext({ directory, title: "Processor retry" })
                  const assistantMessage = {
                    id: Identifier.ascending("message"),
                    sessionID: created.id,
                    role: "assistant" as const,
                    parentID: Identifier.ascending("message"),
                    agent: "build",
                    mode: "build",
                    path: { cwd: directory, root: directory },
                    time: { created: Date.now() },
                    cost: 0,
                    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                  }
                  yield* session.updateMessage(assistantMessage)
                  const processor = yield* SessionProcessor.Service
                  const result = yield* processor.create({
                    assistantMessage,
                    sessionID: created.id,
                    model: { id: "test-model", providerID: "test-provider" } as any,
                    abort: new AbortController().signal,
                  })
                  yield* Effect.promise(() =>
                    result.process({
                      user: {} as any,
                      sessionID: created.id,
                      model: {} as any,
                      agent: {} as any,
                      system: [],
                      abort: new AbortController().signal,
                      messages: [],
                      tools: {},
                    }),
                  )
                  return yield* session.messages({ sessionID: created.id })
                }).pipe(Effect.provide(Session.defaultLayer), Effect.provide(SessionProcessor.defaultLayer)),
              ),
            ).then((messages) => expect(messages[0]?.parts).toHaveLength(0))
          } finally {
            unsubscribeUpdate()
            unsubscribeRemove()
          }
        },
      })

      const removed = events.findIndex((event) => event.type === "removed")
      expect(removed).toBeGreaterThanOrEqual(0)
      expect(events.slice(removed + 1)).not.toContainEqual({ type: "updated", partID: events[removed]?.partID })
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})
