import { describe, expect, test } from "bun:test"
import {
  appendInstructionNotice,
  formatInstructionDelta,
  formatInstructionKey,
  isInitialInstructionDelta,
  visibleInstructionNotices,
} from "@nikcli-ai/util/instruction-delta"

describe("instruction-delta", () => {
  test("formats keys without hashes or bodies", () => {
    expect(formatInstructionKey("file:/Users/n/proj/AGENTS.md")).toBe("AGENTS.md")
    expect(formatInstructionKey("file:C:\\Users\\me\\CLAUDE.md")).toBe("CLAUDE.md")
    expect(formatInstructionKey("url:https://example.com/a")).toBe("https://example.com/a")
    expect(formatInstructionKey("env")).toBe("environment")
    expect(formatInstructionKey("profile")).toBe("profile")
    expect(formatInstructionKey("skill:review")).toBe("skill review")
  })

  test("truncates long URLs in the middle", () => {
    const url = "https://example.com/" + "a".repeat(80)
    const label = formatInstructionKey(`url:${url}`)
    expect(label.length).toBeLessThanOrEqual(56)
    expect(label).toContain("…")
    expect(label.startsWith("https://")).toBe(true)
  })

  test("delta line marks removals and never prints hash values", () => {
    const hash = "a".repeat(64)
    const line = formatInstructionDelta({
      "file:/tmp/AGENTS.md": hash,
      env: "removed",
    })
    expect(line).toBe("AGENTS.md · environment removed")
    expect(line).not.toContain(hash)
  })

  test("hides a multi-key first admit and shows later changes", () => {
    const first = appendInstructionNotice(
      undefined,
      {
        env: "aa",
        "file:/tmp/AGENTS.md": "bb",
      },
      1,
    )
    expect(isInitialInstructionDelta(0, first[0]!.delta)).toBe(true)
    expect(first[0]!.initial).toBe(true)
    expect(visibleInstructionNotices(first)).toEqual([])

    const second = appendInstructionNotice(first, { "file:/tmp/AGENTS.md": "cc" }, 2)
    expect(second[1]!.initial).toBe(false)
    expect(visibleInstructionNotices(second).map((n) => formatInstructionDelta(n.delta))).toEqual(["AGENTS.md"])
  })

  test("shows a single-key first event so a forked session change is visible", () => {
    const notices = appendInstructionNotice(undefined, { "file:/tmp/AGENTS.md": "aa" }, 1)
    expect(notices[0]!.initial).toBe(false)
    expect(visibleInstructionNotices(notices)).toHaveLength(1)
  })

  test("ignores empty deltas and caps stored notices", () => {
    expect(appendInstructionNotice(undefined, {}, 1)).toEqual([])
    let list = appendInstructionNotice(undefined, { env: "a", profile: "b" }, 0)
    for (let i = 1; i <= 25; i++) {
      list = appendInstructionNotice(list, { env: String(i) }, i)
    }
    expect(list.length).toBe(20)
    expect(visibleInstructionNotices(list, 3).map((n) => n.delta.env)).toEqual(["23", "24", "25"])
  })
})
