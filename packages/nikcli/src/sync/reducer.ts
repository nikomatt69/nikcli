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
import { Log } from "@/util/log"

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
  ): Promise<{ state: S; lastSeq: number }> {
    const cached = SyncSnapshot.load(key)
    let state: S = cached ? (cached.state as S) : initial
    let lastSeq = cached?.lastSeq ?? 0

    // Read events strictly after the snapshot's seq. The projection is
    // applied in seq order so the result is deterministic.
    const events = await Sync.getEvents(key.projectID, key.aggregate, lastSeq)
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

    if (eventsSinceSnapshot >= SNAPSHOT_INTERVAL || !cached) {
      // Persist a fresh snapshot so the next cold start can skip these
      // events entirely.
      SyncSnapshot.save(key, lastSeq, state)
    }

    return { state, lastSeq }
  }
}
