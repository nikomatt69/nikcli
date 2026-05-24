import { describe, expect, it } from "bun:test"
import { Identifier } from "@/id/id"
import { MessageV2 } from "@/session/message-v2"
import { recordBenchmark } from "../benchmarks/runner"

describe("MessageV2 benchmark", () => {
  it("records toModelMessages for repeated user turns", () => {
    const model = {
      api: { npm: "@ai-sdk/anthropic", id: "minimax-coding-plan" },
      id: "MiniMax-M2.7",
      cost: { input: 1, output: 1, cache: { read: 0, write: 0 } },
    } as Parameters<typeof MessageV2.toModelMessages>[1]

    const iterations = 600
    const sessionID = Identifier.descending("session")
    const start = performance.now()
    let total = 0
    for (let i = 0; i < iterations; i += 1) {
      const messageID = Identifier.ascending("message")
      const msg: MessageV2.WithParts = {
        info: {
          id: messageID,
          role: "user",
          sessionID,
          time: { created: i },
          agent: "a",
          model: { providerID: "minimax-coding-plan", modelID: "MiniMax-M2.7" },
        },
        parts: [
          {
            id: Identifier.ascending("part"),
            sessionID,
            messageID,
            type: "text",
            text: `hello-${i}`,
          },
        ],
      }
      total += MessageV2.toModelMessages([msg], model).length
    }
    const elapsed = performance.now() - start
    recordBenchmark({
      suite: "session",
      module: "message-v2",
      scenario: "toModelMessages user-only loop",
      iterations,
      value: elapsed,
      unit: "ms",
      metadata: { totalMessages: total },
    })
    expect(total).toBe(iterations)
  })

  it("records Part schema parse loop", () => {
    const iterations = 3_000
    const sessionID = Identifier.descending("session")
    const messageID = Identifier.ascending("message")
    const start = performance.now()
    for (let i = 0; i < iterations; i += 1) {
      MessageV2.TextPart.parse({
        id: Identifier.ascending("part"),
        sessionID,
        messageID,
        type: "text",
        text: `x-${i}`,
      })
    }
    const elapsed = performance.now() - start
    recordBenchmark({
      suite: "session",
      module: "message-v2",
      scenario: "TextPart parse loop",
      iterations,
      value: elapsed,
      unit: "ms",
    })
    expect(elapsed).toBeGreaterThanOrEqual(0)
  })
})
