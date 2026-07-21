import { describe, expect, it } from "bun:test"
import { ContentLoop } from "@/util/content-loop"

describe("ContentLoop (opencode #21112)", () => {
  it("returns ignore for short blocks", () => {
    const state = ContentLoop.initial()
    const verdict = ContentLoop.check(state, "hi")
    expect(verdict.action).toBe("ignore")
    expect(verdict.looped).toBe(false)
  })

  it("does not flag a single long block", () => {
    const state = ContentLoop.initial()
    const verdict = ContentLoop.check(state, "x".repeat(500))
    expect(verdict.action).toBe("ignore")
  })

  it("flags two consecutive identical blocks as nudge", () => {
    const state = ContentLoop.initial()
    const block = "the same long reasoning content".repeat(5)
    const first = ContentLoop.check(state, block)
    expect(first.action).toBe("ignore")
    const second = ContentLoop.check(first.state, block)
    expect(second.action).toBe("nudge")
    expect(second.looped).toBe(true)
    expect(second.state.nudges).toBe(1)
  })

  it("ignores blocks that differ by whitespace only via normalize", () => {
    const state = ContentLoop.initial()
    const block = "the same reasoning here we go around"
    const a = ContentLoop.check(state, block + "\n\n  ")
    // b is structurally identical after normalize() collapses whitespace
    const b = ContentLoop.check(a.state, "the\tsame\treasoning here we go around  ")
    expect(b.action).toBe("nudge")
  })

  it("escalates to abort after MAX_NUDGES", () => {
    let state = ContentLoop.initial()
    const block = "the same reasoning block ".repeat(5)
    for (let i = 0; i < 8; i++) {
      const verdict = ContentLoop.check(state, block)
      state = verdict.state
      if (verdict.action === "abort") {
        expect(verdict.action).toBe("abort")
        return
      }
    }
    expect.unreachable("expected abort")
  })

  it("resets streak when a different block arrives", () => {
    const state = ContentLoop.initial()
    const first = ContentLoop.check(state, "alpha alpha alpha alpha alpha")
    const second = ContentLoop.check(first.state, "alpha alpha alpha alpha alpha")
    expect(second.action).toBe("nudge")
    const third = ContentLoop.check(second.state, "completely different content here")
    expect(third.action).toBe("ignore")
    expect(third.state.repeatStreak).toBe(0)
  })
})
