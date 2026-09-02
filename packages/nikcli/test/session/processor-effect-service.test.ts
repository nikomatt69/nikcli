import { describe, expect, it } from "bun:test"
import { SessionProcessor } from "@/session/processor"
import { MessageV2 } from "@/session/message-v2"
import { Effect } from "effect"

describe("SessionProcessor.Service", () => {
  it("accepts structured and content progress on running tool parts", () => {
    const state = MessageV2.ToolStateRunning.parse({
      status: "running",
      input: { description: "inspect" },
      structured: { sessionID: "ses_child", status: "running" },
      content: [
        { type: "text", text: "working" },
        { type: "file", data: "aGVsbG8=", mime: "text/plain", name: "progress.txt" },
      ],
      time: { start: 1 },
    })

    expect(state.structured?.sessionID).toBe("ses_child")
    expect(state.content).toHaveLength(2)
  })

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
        // No instance scope here on purpose: this test exercises the service
        // boundary alone, so the instance is supplied as data like any other
        // field of the input.
        return yield* service.create({
          instance: { directory: "/tmp", worktree: "/tmp", project: { id: "prj_test" } } as any,
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
