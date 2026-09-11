/**
 * Did a replay cursor fall through a compacted range?
 *
 * `getEvents(projectID, aggregate, fromSeq)` returns everything with
 * `seq > fromSeq`, and compaction deletes from the front of an aggregate. When
 * the two meet — the cursor is older than the oldest surviving event — the
 * result still looks like a contiguous tail, so a replay folds it onto a
 * snapshot that predates a hole and produces state nobody can tell is wrong.
 *
 * This does not repair anything: the compacted events are gone, and discarding
 * the snapshot would lose its prefix too, which is worse. It makes the hole
 * observable, which is the difference between a known-degraded projection and a
 * silently incorrect one.
 */
export type SequenceGap = {
  /** The cursor the replay was about to resume from. */
  readonly fromSeq: number
  /** Lowest sequence still on disk. */
  readonly oldestAvailableSeq: number
  /** How many sequence numbers are unaccounted for. */
  readonly missing: number
}

export function detectSequenceGap(input: {
  fromSeq: number
  oldestAvailableSeq: number | undefined
}): SequenceGap | undefined {
  const { fromSeq, oldestAvailableSeq } = input
  // No events left at all: nothing to be discontiguous with.
  if (oldestAvailableSeq === undefined) return undefined
  // A cursor at 0 has no history to lose — it is a cold start, not a gap.
  if (fromSeq <= 0) return undefined
  // The next event must be exactly `fromSeq + 1`. Anything higher means the
  // events in between were deleted rather than never written: `reserveSeq`
  // hands out consecutive numbers per aggregate.
  if (oldestAvailableSeq <= fromSeq + 1) return undefined
  return { fromSeq, oldestAvailableSeq, missing: oldestAvailableSeq - fromSeq - 1 }
}
