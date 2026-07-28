/// <reference types="@types/bun" />

import { describe, expect, test } from "bun:test"
import { WORK_SUGGESTIONS } from "./session-new-view-data"

describe("desktop work suggestions", () => {
  test("provide distinct, actionable prompts", () => {
    expect(WORK_SUGGESTIONS).toHaveLength(4)
    expect(new Set(WORK_SUGGESTIONS.map((item) => item.prompt)).size).toBe(WORK_SUGGESTIONS.length)
    expect(WORK_SUGGESTIONS.every((item) => item.title.length > 0 && item.prompt.length > item.title.length)).toBe(true)
  })
})
