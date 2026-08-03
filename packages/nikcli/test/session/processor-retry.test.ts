import { afterAll, describe, expect, it, spyOn } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { removeTestDir } from "../helpers/fs"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-processor-retry-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

const [
  { SessionProcessor },
  { Session },
  { LLM },
  { SessionRetry },
  { locallyInstance },
  { Identifier },
  { Bus },
  { MessageV2 },
  { Instance },
  { Effect },
] = await Promise.all([
  import("@/session/processor"),
  import("@/session"),
  import("@/session/llm"),
  import("@/session/retry"),
  import("@/effect"),
  import("@/id/id"),
  import("@/bus"),
  import("@/session/message-v2"),
  import("@/project/instance"),
  import("effect"),
])

// Spies, not `mock.module`: a module mock replaces the module for the whole bun
// process and cannot be undone, so stubbing `@/session/retry` here left every
// later file in the run with `SessionRetry.delay === () => 0` (all of
// retry.test.ts failed whenever it ran after this file).
let streamAttempt = 0
const spies = [
  spyOn(LLM, "stream").mockImplementation((async () => {
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
  }) as unknown as typeof LLM.stream),
  spyOn(SessionRetry, "delay").mockReturnValue(0),
  spyOn(SessionRetry, "retryable").mockReturnValue("Temporary provider failure"),
  spyOn(SessionRetry, "sleep").mockResolvedValue(undefined),
]

afterAll(async () => {
  for (const spy of spies) spy.mockRestore()
  await removeTestDir(testHome)
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
                  yield* session.updateMessage(assistantMessage as any)
                  const processor = yield* SessionProcessor.Service
                  const result = yield* processor.create({
                    assistantMessage: assistantMessage as any,
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
