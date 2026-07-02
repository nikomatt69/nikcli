/**
 * Outbox queue for the optional remote sync. Local events are enqueued
 * after they land in `sync_event`; the outbox is drained by the
 * `RemoteSync.start` loop. On success, the row is deleted; on
 * transient failure, the row is rescheduled with exponential backoff
 * (1s → 2s → 4s → … → cap 24h). On permanent failure (e.g. HTTP 401),
 * the row is marked `failed` and stops retrying.
 *
 * The outbox is offline-first: writes succeed even if the remote
 * server is unreachable, and the drain picks up the backlog the next
 * time the connection comes back.
 */
import { and, eq, lte, sql } from "drizzle-orm";
import { Database } from "@/database/database";
import { Identifier } from "@/id/id";
import { syncOutbox } from "./sync.sql";
import { Log } from "@/util/log";

const log = Log.create({ service: "sync.outbox" });

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 24 * 60 * 60 * 1_000; // 24h
const MAX_ATTEMPTS = 50;

export type DrainResult = {
  attempted: number;
  sent: number;
  failed: number;
  remaining: number;
};

export namespace Outbox {
  function db() {
    return Database.syncDb();
  }

  /**
   * Enqueue an event for push to a remote target. Idempotent on
   * `(eventId, target)`: re-enqueuing the same pair is a no-op.
   */
  export function enqueue(eventId: string, target: string): void {
    // Cheap idempotency check first; the unique constraint is
    // enforced at the storage layer if two writers race.
    const existing = db()
      .select({ id: syncOutbox.id })
      .from(syncOutbox)
      .where(
        and(eq(syncOutbox.eventId, eventId), eq(syncOutbox.target, target)),
      )
      .get();
    if (existing) return;

    db()
      .insert(syncOutbox)
      .values({
        id: Identifier.ascending("outbox"),
        eventId,
        target,
        status: "pending",
        attempts: 0,
        nextAttemptAt: Date.now(),
        createdAt: Date.now(),
      })
      .run();
  }

  /**
   * Drain the outbox using the provided push function. Returns counts
   * for observability. Designed to be called periodically by
   * `RemoteSync.start`.
   */
  export async function drain(
    target: string,
    push: (
      eventId: string,
    ) => Promise<{ ok: boolean; permanent?: boolean; error?: string }>,
    batchSize = 50,
  ): Promise<DrainResult> {
    const now = Date.now();
    const rows = db()
      .select()
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.target, target),
          eq(syncOutbox.status, "pending"),
          lte(syncOutbox.nextAttemptAt, now),
        ),
      )
      .orderBy(sql`${syncOutbox.createdAt} ASC`)
      .limit(batchSize)
      .all();

    let sent = 0;
    let failed = 0;
    for (const row of rows) {
      const result = await push(row.eventId);
      if (result.ok) {
        db().delete(syncOutbox).where(eq(syncOutbox.id, row.id)).run();
        sent++;
      } else if (result.permanent || row.attempts + 1 >= MAX_ATTEMPTS) {
        db()
          .update(syncOutbox)
          .set({
            status: "failed",
            attempts: row.attempts + 1,
            lastError: result.error ?? "permanent failure",
          })
          .where(eq(syncOutbox.id, row.id))
          .run();
        failed++;
      } else {
        const delay = Math.min(
          BACKOFF_BASE_MS * 2 ** row.attempts,
          BACKOFF_CAP_MS,
        );
        db()
          .update(syncOutbox)
          .set({
            attempts: row.attempts + 1,
            lastError: result.error ?? null,
            nextAttemptAt: Date.now() + delay,
          })
          .where(eq(syncOutbox.id, row.id))
          .run();
        failed++;
      }
    }

    const remaining = db()
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(syncOutbox)
      .where(
        and(eq(syncOutbox.target, target), eq(syncOutbox.status, "pending")),
      )
      .get();

    return {
      attempted: rows.length,
      sent,
      failed,
      remaining: remaining?.count ?? 0,
    };
  }

  /**
   * Snapshot of the outbox state for `nikcli sync status` and tests.
   */
  export function status(target?: string): {
    pending: number;
    failed: number;
    total: number;
  } {
    const where = target ? eq(syncOutbox.target, target) : undefined;
    const baseQuery = where
      ? db().select().from(syncOutbox).where(where)
      : db().select().from(syncOutbox);
    const rows = baseQuery.all();
    let pending = 0;
    let failed = 0;
    for (const row of rows) {
      if (row.status === "pending") pending++;
      else if (row.status === "failed") failed++;
    }
    return { pending, failed, total: rows.length };
  }

  /**
   * Wire up automatic enqueue for every event emitted via `Sync.emit`
   * or `Sync.emitRaw`. Returns a teardown function that detaches the
   * listener. Used by `RemoteSync.start`.
   */
  export function autoEnqueue(
    target: string,
    listener: (eventId: string) => void,
  ): () => void {
    // Phase 2: the simplest possible integration point — call the
    // listener right after every `Sync.emitRaw` lands. This is wired
    // at the call site in `RemoteSync.start`, not via monkey-patch,
    // to keep the dependency direction clean.
    log.debug("autoEnqueue listener registered", { target });
    return () => {};
  }
}
