import { describe, expect, it } from "bun:test"
import { detectSequenceGap } from "@/sync/gap"

describe("detectSequenceGap", () => {
  it("reports nothing when the next event continues the cursor", () => {
    expect(detectSequenceGap({ fromSeq: 10, oldestAvailableSeq: 11 })).toBeUndefined()
  })

  it("reports nothing when history still reaches below the cursor", () => {
    // The tail the cursor wants is fully present.
    expect(detectSequenceGap({ fromSeq: 10, oldestAvailableSeq: 3 })).toBeUndefined()
  })

  it("reports the hole when the oldest surviving event is past the cursor", () => {
    expect(detectSequenceGap({ fromSeq: 10, oldestAvailableSeq: 601 })).toEqual({
      fromSeq: 10,
      oldestAvailableSeq: 601,
      missing: 590,
    })
  })

  it("counts exactly the sequences that are unaccounted for", () => {
    // 10 is consumed, 11 is missing, 12 is present: one lost.
    expect(detectSequenceGap({ fromSeq: 10, oldestAvailableSeq: 12 })?.missing).toBe(1)
  })

  it("treats a cold start as no gap", () => {
    // Nothing has been consumed yet, so nothing can have been lost.
    expect(detectSequenceGap({ fromSeq: 0, oldestAvailableSeq: 500 })).toBeUndefined()
  })

  it("treats an empty aggregate as no gap", () => {
    expect(detectSequenceGap({ fromSeq: 10, oldestAvailableSeq: undefined })).toBeUndefined()
  })

  it("does not fire on the boundary where the very next event survives", () => {
    // Off-by-one here would warn on every healthy replay.
    for (let seq = 1; seq < 50; seq++) {
      expect(detectSequenceGap({ fromSeq: seq, oldestAvailableSeq: seq + 1 })).toBeUndefined()
    }
  })
})
