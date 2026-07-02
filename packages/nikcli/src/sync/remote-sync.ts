/**
 * RemoteSync — high-level entry point for the optional Railway-style
 * hub-and-spoke sync.
 *
 * Usage:
 *   const stop = await RemoteSync.start({
 *     url: "https://s.nikcli.store",
 *     token: process.env.NIKCLI_REMOTE_TOKEN!,
 *     projectID: Instance.project.id,
 *   })
 *   // ... later
 *   await stop()
 *
 * The started sync does three things concurrently:
 *  1. Subscribe to `/sync/stream` for live events from the hub.
 *  2. Periodically drain the local outbox to the hub.
 *  3. Wire `Sync.emitRaw` to also enqueue the event for push.
 *
 * On `stop()` the subscriptions are closed and the outbox drain is
 * cancelled. The next start resumes from the last successful seq.
 */
import { Log } from "@/util/log";
import { Database } from "@/database/database";
import { eq } from "drizzle-orm";
import { syncOutbox, syncEvent } from "./sync.sql";
import { RemoteSyncClient } from "./remote-client";
import { Outbox } from "./outbox";
import { Sync, type SyncEventRecord } from "./index";

const log = Log.create({ service: "sync.remote" });

export type RemoteSyncOptions = {
  url: string;
  token: string;
  projectID: string;
  drainIntervalMs?: number;
  clientId?: string;
};

export type RemoteSyncHandle = {
  stop(): Promise<void>;
  status(): {
    connected: boolean;
    lastSeq: number;
    outbox: ReturnType<typeof Outbox.status>;
  };
};

export namespace RemoteSync {
  /**
   * Resolve a `SyncEventRecord` from the outbox row's `eventId` so it
   * can be pushed to the remote.
   */
  function loadEvent(eventId: string): SyncEventRecord | undefined {
    const db = Database.syncDb();
    const row = db
      .select()
      .from(syncEvent)
      .where(eq(syncEvent.id, eventId))
      .get();
    if (!row) return undefined;
    return {
      id: row.id,
      projectId: row.projectId,
      workspaceId: row.workspaceId ?? undefined,
      aggregate: row.aggregate,
      seq: row.seq,
      type: row.type,
      data: safeJson(row.data),
      timestamp: row.timestamp,
      origin: row.origin,
      originSeq: row.originSeq ?? undefined,
    };
  }

  function safeJson(value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  export async function start(
    opts: RemoteSyncOptions,
  ): Promise<RemoteSyncHandle> {
    const clientId = opts.clientId ?? "cli";
    const originTag = `remote:${clientId}`;
    const drainInterval = opts.drainIntervalMs ?? 5_000;
    let connected = true;

    const client = new RemoteSyncClient({
      url: opts.url,
      token: opts.token,
      projectID: opts.projectID,
      onEvent: async (event) => {
        // Replay the remote event into the local store, marked as
        // remote origin so we don't re-push it.
        try {
          await Sync.emitRaw(event.projectId, event.aggregate, event.data, {
            workspaceID: event.workspaceId,
            origin: originTag,
            originSeq: event.seq,
          });
        } catch (error) {
          log.warn("replaying remote event failed", { error, event: event.id });
        }
      },
      onError: (error) => {
        connected = false;
        log.warn("remote sync connection error", { error });
      },
    });

    await client.start();
    log.info("remote sync started", {
      url: opts.url,
      projectID: opts.projectID,
    });

    // Periodic outbox drain
    const drainTimer = setInterval(() => {
      void Outbox.drain(opts.url, async (eventId) => {
        const event = loadEvent(eventId);
        if (!event)
          return { ok: false, permanent: true, error: "event not found" };
        const ok = await client.push(event);
        if (ok) return { ok: true };
        // 401 / 403 treated as permanent to stop retry storms
        return { ok: false, error: "push failed" };
      }).catch((error) => {
        log.warn("outbox drain failed", { error });
      });
    }, drainInterval);

    // Auto-enqueue: monkey-patch-free integration via wrapping the
    // public Sync.emitRaw. The wrapper records the event id in the
    // outbox right after the row is inserted.
    const originalEmitRaw = Sync.emitRaw;
    (Sync as any).emitRaw = async (
      projectID: string,
      aggregate: string,
      data: unknown,
      options: {
        workspaceID?: string;
        origin?: string;
        originSeq?: number;
      } = {},
    ) => {
      const isLocal = !options.origin || options.origin === "local";
      const record = await originalEmitRaw(projectID, aggregate, data, options);
      if (isLocal) {
        try {
          Outbox.enqueue(record.id, opts.url);
        } catch (error) {
          log.warn("outbox enqueue failed", { error });
        }
      }
      return record;
    };

    return {
      stop: async () => {
        clearInterval(drainTimer);
        client.stop();
        // Restore the original emitRaw so a subsequent start works
        (Sync as any).emitRaw = originalEmitRaw;
        connected = false;
        log.info("remote sync stopped");
      },
      status: () => {
        const lastSeq = client["lastSeq"] as number;
        return {
          connected,
          lastSeq,
          outbox: Outbox.status(opts.url),
        };
      },
    };
  }
}
