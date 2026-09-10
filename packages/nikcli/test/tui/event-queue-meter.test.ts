import { describe, expect, it } from "bun:test"
import { createQueueMeter } from "@tui/util/event-queue-meter"

describe("createQueueMeter", () => {
  it("tracks depth across admit and flush", () => {
    const meter = createQueueMeter(10)
    meter.admit(3)
    expect(meter.snapshot().depth).toBe(3)
    meter.flush(2)
    expect(meter.snapshot()).toMatchObject({ depth: 1, admitted: 3, flushed: 2 })
  })

  it("records the high-water mark, not just the current depth", () => {
    const meter = createQueueMeter(10)
    meter.admit(7)
    meter.flush(7)
    expect(meter.snapshot()).toMatchObject({ depth: 0, highWater: 7 })
  })

  it("reports overload once per crossing, not once per event", () => {
    const seen: number[] = []
    const meter = createQueueMeter(3, (snapshot) => seen.push(snapshot.depth))
    meter.admit(5)
    meter.admit(5)
    expect(seen).toEqual([5])
    expect(meter.snapshot()).toMatchObject({ overloads: 1, overloaded: true })
  })

  it("re-arms only after the queue recovers below the threshold", () => {
    const seen: number[] = []
    const meter = createQueueMeter(3, (snapshot) => seen.push(snapshot.depth))
    meter.admit(4)
    meter.flush(2) // depth 2, below threshold → re-armed
    meter.admit(3) // depth 5 → crosses again
    expect(seen).toEqual([4, 5])
    expect(meter.snapshot().overloads).toBe(2)
  })

  it("stays armed while the depth hovers at the threshold", () => {
    const seen: number[] = []
    const meter = createQueueMeter(3, (snapshot) => seen.push(snapshot.depth))
    meter.admit(3)
    meter.flush(0)
    meter.admit(1)
    expect(seen).toEqual([3])
  })

  it("never reports a negative depth", () => {
    const meter = createQueueMeter(10)
    meter.admit(1)
    meter.flush(5)
    expect(meter.snapshot().depth).toBe(0)
  })

  it("ignores non-positive counts", () => {
    const meter = createQueueMeter(10)
    meter.admit(0)
    meter.admit(-3)
    meter.flush(-1)
    expect(meter.snapshot()).toMatchObject({ depth: 0, admitted: 0, flushed: 0 })
  })

  it("rejects a non-positive threshold", () => {
    expect(() => createQueueMeter(0)).toThrow(RangeError)
    expect(() => createQueueMeter(Number.NaN)).toThrow(RangeError)
  })
})
