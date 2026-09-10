/**
 * Depth accounting for the SDK client's event batch.
 *
 * The batch array between the SSE reader and the 16 ms flush has no capacity:
 * if the renderer stalls, or events arrive faster than a flush retires them, it
 * grows without a bound anyone can observe. Capping it is not safe on its own —
 * dropping a permission prompt or a final outcome to make the view faster is a
 * correctness regression — so the first step is to make overload *measurable*,
 * which is what an admission cap would later have to be justified against.
 *
 * Overload is edge-triggered: a sustained burst reports once when it crosses
 * the threshold and again only after the queue has recovered below it.
 */
export type QueueMeterSnapshot = {
  /** Envelopes admitted and not yet flushed. */
  readonly depth: number
  /** Highest depth seen since creation. */
  readonly highWater: number
  readonly admitted: number
  readonly flushed: number
  /** Times the depth crossed the threshold from below. */
  readonly overloads: number
  readonly overloaded: boolean
}

export type QueueMeter = {
  /** Record `count` newly queued envelopes. */
  admit(count?: number): void
  /** Record `count` envelopes leaving the queue. */
  flush(count: number): void
  snapshot(): QueueMeterSnapshot
}

export function createQueueMeter(threshold: number, onOverload?: (snapshot: QueueMeterSnapshot) => void): QueueMeter {
  if (!Number.isFinite(threshold) || threshold < 1) throw new RangeError("threshold must be a positive number")
  let depth = 0
  let highWater = 0
  let admitted = 0
  let flushed = 0
  let overloads = 0
  let overloaded = false

  const snapshot = (): QueueMeterSnapshot => ({ depth, highWater, admitted, flushed, overloads, overloaded })

  return {
    admit(count = 1) {
      if (count <= 0) return
      depth += count
      admitted += count
      if (depth > highWater) highWater = depth
      if (!overloaded && depth >= threshold) {
        overloaded = true
        overloads++
        onOverload?.(snapshot())
      }
    },
    flush(count) {
      if (count <= 0) return
      // Never below zero: a flush that retires more than was admitted is a
      // caller bug, and a negative depth would hide the next real overload.
      depth = Math.max(0, depth - count)
      flushed += count
      if (overloaded && depth < threshold) overloaded = false
    },
    snapshot,
  }
}
