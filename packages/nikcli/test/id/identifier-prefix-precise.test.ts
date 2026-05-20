import { describe, expect, it } from "bun:test"
import { Identifier } from "@/id/id"

/** Minimal valid string per schema: prefix + underscore + one char (startsWith only). */
const minimalBySchema = {
  session: "ses_",
  message: "msg_",
  permission: "per_",
  question: "que_",
  user: "usr_",
  part: "prt_",
  pty: "pty_",
  tool: "tool_",
  dbedit: "dbe_",
  workspace: "wrk_",
  sync: "syn_",
  event: "evt_",
  account: "acc_",
  org: "org_",
} as const

describe("Identifier.schema — every prefix accepts minimal valid and rejects wrong prefix", () => {
  for (const [key, sample] of Object.entries(minimalBySchema)) {
    const k = key as keyof typeof minimalBySchema
    it(`${key}: parse(${JSON.stringify(sample)}) === sample`, () => {
      expect(Identifier.schema(k).parse(sample)).toBe(sample)
    })
    it(`${key}: rejects adjacent prefix (session vs message)`, () => {
      const wrong = k === "session" ? "msg_xx" : k === "message" ? "ses_xx" : `wrong_${sample}`
      expect(() => Identifier.schema(k).parse(wrong)).toThrow()
    })
  }
})

describe("Identifier.create layout", () => {
  it("id shape: prefix underscore + 12 hex + 14 base62 (= 26 suffix chars)", () => {
    const id = Identifier.create("session", false, 1_700_000_000_000)
    const [, suffix] = id.split("_")
    expect(suffix!.length).toBe(26)
    expect(suffix!.slice(0, 12)).toMatch(/^[0-9a-f]{12}$/)
  })

  it("timestamp() returns a positive number derived from id hex prefix", () => {
    const id = Identifier.create("message", false, 1_711_111_111_111)
    expect(Number.isFinite(Identifier.timestamp(id))).toBe(true)
    expect(Identifier.timestamp(id)).toBeGreaterThan(0)
  })

  it("two creates at same timestamp get different ids (counter)", () => {
    const ts = 1_711_111_111_111
    const a = Identifier.create("message", false, ts)
    const b = Identifier.create("message", false, ts)
    expect(a).not.toBe(b)
    expect(a.startsWith("msg_")).toBe(true)
    expect(b.startsWith("msg_")).toBe(true)
  })
})
