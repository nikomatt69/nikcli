import { describe, expect, it } from "bun:test"
import { Identifier } from "@/id/id"
import { MessageV2 } from "@/session/message-v2"
import { SessionEvent } from "@/session/v2/event"

const base = {
  id: Identifier.ascending("event"),
  sessionID: Identifier.descending("session"),
  timestamp: 1_700_000_000_000,
}

describe("SessionEvent", () => {
  it("parses prompt", () => {
    const evt = SessionEvent.Event.parse({
      ...base,
      type: "prompt",
      messageID: Identifier.ascending("message"),
      text: "hello",
      files: [],
      agents: [],
    })
    expect(evt.type).toBe("prompt")
  })

  it("parses synthetic with default role", () => {
    const evt = SessionEvent.Event.parse({
      ...base,
      type: "synthetic",
      messageID: Identifier.ascending("message"),
      text: "sys",
    })
    expect(evt.type).toBe("synthetic")
    if (evt.type === "synthetic") expect(evt.role).toBe("assistant")
  })

  it("parses step.started and step.ended", () => {
    const mid = Identifier.ascending("message")
    const started = SessionEvent.StepStarted.parse({
      ...base,
      type: "step.started",
      messageID: mid,
      providerID: "p",
      modelID: "m",
      agent: "build",
    })
    expect(started.type).toBe("step.started")

    const ended = SessionEvent.StepEnded.parse({
      ...base,
      type: "step.ended",
      messageID: mid,
      reason: "stop",
      tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
    })
    expect(ended.type).toBe("step.ended")
  })

  it("parses retry.error with API error payload", () => {
    const evt = SessionEvent.RetryError.parse({
      ...base,
      type: "retry.error",
      messageID: Identifier.ascending("message"),
      attempt: 1,
      error: {
        message: "rate limited",
        isRetryable: true,
        statusCode: 429,
      },
    })
    expect(evt.attempt).toBe(1)
  })

  it("parses part.updated for text part", () => {
    const mid = Identifier.ascending("message")
    const part = MessageV2.TextPart.parse({
      id: Identifier.ascending("part"),
      sessionID: base.sessionID,
      messageID: mid,
      type: "text",
      text: "x",
    })
    const evt = SessionEvent.PartUpdated.parse({
      ...base,
      type: "part.updated",
      part,
    })
    expect(evt.part.type).toBe("text")
  })

  it("parses part.removed", () => {
    const evt = SessionEvent.PartRemoved.parse({
      ...base,
      type: "part.removed",
      messageID: Identifier.ascending("message"),
      partID: Identifier.ascending("part"),
    })
    expect(evt.type).toBe("part.removed")
  })

  it("create fills id and timestamp", () => {
    const evt = SessionEvent.create({
      type: "synthetic",
      sessionID: base.sessionID,
      messageID: Identifier.ascending("message"),
      text: "t",
    })
    expect(evt.id.startsWith("evt_")).toBe(true)
    expect(typeof evt.timestamp).toBe("number")
  })
})
