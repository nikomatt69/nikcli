import { describe, expect, it } from "bun:test"
import { SessionProcessor } from "@/session/processor"
import { Effect } from "effect"

describe("SessionProcessor.Service", () => {
  it("creates processor instances through the Effect service boundary", async () => {
    const assistantMessage = {
      id: "msg_test",
      sessionID: "ses_test",
      role: "assistant",
      parentID: "msg_parent",
      agent: "build",
      mode: "build",
      path: {
        cwd: "/tmp",
        root: "/tmp",
      },
      time: {
        created: Date.now(),
      },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
    } as any

    const processor = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SessionProcessor.Service
        return yield* service.create({
          assistantMessage,
          sessionID: "ses_test",
          model: { id: "test-model", providerID: "test-provider" } as any,
          abort: new AbortController().signal,
        })
      }).pipe(Effect.provide(SessionProcessor.defaultLayer)),
    )

    expect(processor.message).toBe(assistantMessage)
    expect(processor.partFromToolCall("missing")).toBeUndefined()
  })
})
