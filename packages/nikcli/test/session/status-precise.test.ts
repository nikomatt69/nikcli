import { describe, expect, it } from "bun:test"
import { SessionStatus } from "@/session/status"

describe("SessionStatus.Info — zod rejects invalid unions", () => {
  const bad: unknown[] = [{}, { type: "retry" }, { type: "retry", attempt: 1, message: "m" }, { type: "unknown" }]
  for (const input of bad) {
    it(`rejects ${JSON.stringify(input)}`, () => {
      expect(SessionStatus.Info.safeParse(input).success).toBe(false)
    })
  }

  it("strips unknown keys on idle (zod object default)", () => {
    expect(SessionStatus.Info.parse({ type: "idle", extra: 1 } as any)).toEqual({ type: "idle" })
  })
})

describe("SessionStatus.Info — exact success shapes", () => {
  it("idle has only type", () => {
    expect(SessionStatus.Info.parse({ type: "idle" })).toEqual({ type: "idle" })
  })

  it("busy has only type", () => {
    expect(SessionStatus.Info.parse({ type: "busy" })).toEqual({ type: "busy" })
  })

  it("retry preserves numeric fields exactly", () => {
    const v = SessionStatus.Info.parse({
      type: "retry",
      attempt: 0,
      message: "",
      next: 0,
    })
    expect(v).toEqual({ type: "retry", attempt: 0, message: "", next: 0 })
  })
})
