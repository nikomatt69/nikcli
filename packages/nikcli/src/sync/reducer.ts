/**
 * Cold-start reducer: load the latest snapshot for an aggregate, replay
 * only the events with `seq > lastSeq`, save a new snapshot every
 * `SNAPSHOT_INTERVAL` events.
 *
 * The reducer is the canonical "give me the current state of X" entry
 * point for downstream readers (UI, API, CLI). It replaces the previous
 * `WorkspaceDB.getState` JSON-column read and is safe to call on every
 * cold start: the cost is one snapshot read + a small bounded event
 * replay (capped at `SNAPSHOT_INTERVAL` events on a healthy cache).
 */
import { Sync, type SyncEventRecord } from "./index"
import { SyncSnapshot, SNAPSHOT_INTERVAL, type SnapshotKey } from "./snapshot"
import { detectSequenceGap, type SequenceGap } from "./gap"
import { Log } from "@nikcli-ai/util/log"

const log = Log.create({ service: "sync.reducer" })

type Projector<S> = (state: S, event: SyncEventRecord) => S

export namespace SyncReducer {
  /**
   * Reconstruct the state of a single aggregate by combining a snapshot
   * with the events recorded after it. `initial` is the empty state
   * used when no snapshot exists. `projectors` are applied in order
   * for each event (chain pattern, like Redux middleware).
   */
  export async function replayWithSnapshot<S>(
    key: SnapshotKey,
    initial: S,
    projectors: Projector<S>[],
  ): Promise<{ state: S; lastSeq: number; gap?: SequenceGap }> {
    const cached = SyncSnapshot.load(key)
    // SAFETY: the snapshot is loaded under the same `key` the projectors for
    // `S` write it under, so a cached state for this key is an `S`.
    let state: S = cached ? (cached.state as S) : initial
    let lastSeq = cached?.lastSeq ?? 0
    let incomplete: SequenceGap | undefined

    // Read events strictly after the snapshot's seq. The projection is
    // applied in seq order so the result is deterministic.
    const events = await Sync.getEvents(key.projectID, key.aggregate, lastSeq)

    // Compaction deletes from the front of an aggregate without consulting any
    // snapshot's cursor, so a snapshot that has fallen far enough behind can be
    // resumed across a hole. The events below the floor are gone either way —
    // discarding the snapshot would drop its prefix too — so this reports the
    // hole rather than pretending to repair it. Silence here is a projection
    // that is wrong and says it is fine.
    if (cached) {
      const gap = detectSequenceGap({
        fromSeq: lastSeq,
        oldestAvailableSeq: await Sync.oldestSeq(key.projectID, key.aggregate),
      })
      if (gap) {
        log.error("replaying across a compacted range; projection is incomplete", { ...key, ...gap })
        incomplete = gap
      }
    }
    let eventsSinceSnapshot = 0
    for (const event of events) {
      for (const projector of projectors) {
        try {
          state = projector(state, event)
        } catch (error) {
          log.error("projector failed", { ...key, type: event.type, error })
        }
      }
      lastSeq = Math.max(lastSeq, event.seq)
      eventsSinceSnapshot++
    }

    // A projection that replayed across a hole is incomplete, and persisting it
    // would launder the hole into the durable record: the next cold start would
    // load a snapshot that looks authoritative and has no way to know it is
    // missing a prefix. The gap stays reported and the old snapshot stays put.
    // `specs/effect-tui/15-sync-snapshots-watermarks.md` requirement 4 — a gap
    // surfaces as visible stale state, never as silent catch-up.
    if (!incomplete && (eventsSinceSnapshot >= SNAPSHOT_INTERVAL || !cached)) {
      // Persist a fresh snapshot so the next cold start can skip these
      // events entirely.
      SyncSnapshot.save(key, lastSeq, state)
    }

    return incomplete ? { state, lastSeq, gap: incomplete } : { state, lastSeq }
  }
}
