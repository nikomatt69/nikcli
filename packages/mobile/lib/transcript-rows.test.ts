/// <reference types="@types/bun" />

import { describe, expect, test } from "bun:test"
import { buildTranscriptRows, clockLabel, isScaffoldingMessage, scaffoldingText } from "./transcript-rows"
import type { MessageWithParts } from "./types"

function userMessage(input: { id: string; at: number; text: string; synthetic?: boolean }): MessageWithParts {
  return {
    info: {
      id: input.id,
      sessionID: "ses_test",
      role: "user",
      time: { created: input.at },
      agent: "build",
      model: { providerID: "anthropic", modelID: "claude" },
    },
    parts: [
      {
        id: `part_${input.id}`,
        sessionID: "ses_test",
        messageID: input.id,
        type: "text",
        text: input.text,
        ...(input.synthetic ? { synthetic: true } : null),
      },
    ],
  }
}

function assistantMessage(input: { id: string; at: number }): MessageWithParts {
  return {
    info: {
      id: input.id,
      sessionID: "ses_test",
      role: "assistant",
      time: { created: input.at },
      cost: 0,
      tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts: [],
  }
}

describe("buildTranscriptRows", () => {
  test("opens with a timestamp and keeps message order", () => {
    const rows = buildTranscriptRows([
      userMessage({ id: "m1", at: 1_000, text: "hi" }),
      assistantMessage({ id: "m2", at: 2_000 }),
    ])

    expect(rows.map((row) => row.kind)).toEqual(["time", "message", "message"])
    expect(rows[1]).toMatchObject({ id: "m1" })
  })

  test("inserts a timestamp only after a real pause", () => {
    const start = 1_000_000
    const rows = buildTranscriptRows([
      userMessage({ id: "m1", at: start, text: "hi" }),
      assistantMessage({ id: "m2", at: start + 60_000 }),
      userMessage({ id: "m3", at: start + 60_000 + 31 * 60 * 1000, text: "still there?" }),
    ])

    expect(rows.filter((row) => row.kind === "time")).toHaveLength(2)
    expect(rows.map((row) => row.kind)).toEqual(["time", "message", "message", "time", "message"])
  })

  test("marks injected context as scaffolding, not conversation", () => {
    const rows = buildTranscriptRows([
      userMessage({ id: "m1", at: 1_000, text: "<env>…</env>", synthetic: true }),
      userMessage({ id: "m2", at: 2_000, text: "hi" }),
    ])

    expect(rows.map((row) => row.kind)).toEqual(["time", "system", "message"])
  })
})

describe("isScaffoldingMessage", () => {
  test("an assistant message is never scaffolding", () => {
    expect(isScaffoldingMessage(assistantMessage({ id: "m1", at: 1 }))).toBe(false)
  })

  test("a partly synthetic message stays conversation", () => {
    const message = userMessage({ id: "m1", at: 1, text: "hi" })
    message.parts.push({
      id: "part_extra",
      sessionID: "ses_test",
      messageID: "m1",
      type: "text",
      text: "<env/>",
      synthetic: true,
    })

    expect(isScaffoldingMessage(message)).toBe(false)
  })
})

describe("scaffoldingText", () => {
  test("joins the injected parts", () => {
    const message = userMessage({ id: "m1", at: 1, text: "<env>a</env>", synthetic: true })
    expect(scaffoldingText(message)).toBe("<env>a</env>")
  })
})

describe("clockLabel", () => {
  test("pads minutes", () => {
    const at = new Date(2026, 0, 1, 4, 3).getTime()
    expect(clockLabel(at)).toBe("4:03")
  })
})
