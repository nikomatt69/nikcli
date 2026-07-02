/**
 * Cold-start projection cache. Stores a compact JSON of the last
 * projector-applied state per `(projectID, aggregate, aggregateID)`,
 * together with the last sequence number it was derived from. On the
 * next cold start, the reducer loads the snapshot, replays only the
 * events with `seq > lastSeq`, and persists a new snapshot every
 * `SNAPSHOT_INTERVAL` events.
 *
 * Snapshots are a cache, not a source of truth: if the row is missing
 * or corrupt, the reducer falls back to a full replay from `seq=0`.
 */
import { and, eq } from "drizzle-orm";
import { Database } from "@/database/database";
import { syncSnapshot } from "./sync.sql";
import { Log } from "@/util/log";

const log = Log.create({ service: "sync.snapshot" });

export const SNAPSHOT_INTERVAL = 100;

export type SnapshotKey = {
  projectID: string;
  aggregate: string;
  aggregateID: string;
};

export namespace SyncSnapshot {
  function db() {
    return Database.syncDb();
  }

  export function load(
    key: SnapshotKey,
  ): { lastSeq: number; state: unknown } | undefined {
    const row = db()
      .select()
      .from(syncSnapshot)
      .where(
        and(
          eq(syncSnapshot.projectId, key.projectID),
          eq(syncSnapshot.aggregate, key.aggregate),
          eq(syncSnapshot.aggregateId, key.aggregateID),
        ),
      )
      .get();
    if (!row) return undefined;
    try {
      return { lastSeq: row.lastSeq, state: JSON.parse(row.state) };
    } catch (error) {
      log.warn("snapshot corrupt, will rebuild from scratch", {
        ...key,
        error,
      });
      return undefined;
    }
  }

  export function save(
    key: SnapshotKey,
    lastSeq: number,
    state: unknown,
  ): void {
    const serialized = JSON.stringify(state ?? {});
    const now = Date.now();
    db()
      .insert(syncSnapshot)
      .values({
        projectId: key.projectID,
        aggregate: key.aggregate,
        aggregateId: key.aggregateID,
        lastSeq,
        state: serialized,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          syncSnapshot.projectId,
          syncSnapshot.aggregate,
          syncSnapshot.aggregateId,
        ],
        set: { lastSeq, state: serialized, updatedAt: now },
      })
      .run();
  }

  export function clear(key: SnapshotKey): void {
    db()
      .delete(syncSnapshot)
      .where(
        and(
          eq(syncSnapshot.projectId, key.projectID),
          eq(syncSnapshot.aggregate, key.aggregate),
          eq(syncSnapshot.aggregateId, key.aggregateID),
        ),
      )
      .run();
  }
}
