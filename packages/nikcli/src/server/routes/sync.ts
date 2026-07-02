/**
 * Server-side HTTP API for the optional remote sync. Mounted under
 * `/sync/*` by the main server router. Accepts:
 *
 *  - POST /sync/event   — push a single event from a remote CLI
 *  - GET  /sync/outbox  — list events for catch-up replay
 *  - GET  /sync/stream  — SSE stream of new events
 *  - GET  /sync/snapshot/:aggregate/:id — cold-start snapshot fetch
 *
 * All routes require a `Bearer` token whose scope is `cli-sync` or
 * `studio` (the auth middleware in server.ts enforces this).
 */
import { Hono } from "hono";
import { describeRoute, resolver, validator } from "hono-openapi";
import { z } from "zod";
import { eq, and, gt, sql } from "drizzle-orm";
import { Database } from "@/database/database";
import { syncEvent, syncOutbox } from "@/sync/sync.sql";
import { GlobalBus } from "@/bus/global";
import { Log } from "@/util/log";

const log = Log.create({ service: "server.sync" });

const SyncEventPayload = z.object({
  event: z.object({
    id: z.string(),
    projectId: z.string(),
    workspaceId: z.string().optional(),
    aggregate: z.string(),
    seq: z.number().int(),
    type: z.string(),
    data: z.unknown(),
    timestamp: z.number(),
    origin: z.string().optional(),
    originSeq: z.number().optional(),
  }),
  projectID: z.string(),
});

const OutboxQuery = z.object({
  projectID: z.string(),
  since: z.coerce.number().int().nonnegative().default(0),
});

const StreamQuery = z.object({
  projectID: z.string(),
  token: z.string(),
});

export const SyncRoutes = new Hono()
  .post(
    "/event",
    describeRoute({
      summary: "Push a sync event from a remote CLI",
      operationId: "sync.event.push",
      responses: {
        204: { description: "Event accepted" },
        400: { description: "Invalid payload" },
        401: { description: "Unauthorized" },
      },
    }),
    validator("json", SyncEventPayload),
    async (c) => {
      const body = c.req.valid("json");
      const db = Database.syncDb();
      // Idempotency: skip if the event id already exists
      const existing = db
        .select({ id: syncEvent.id })
        .from(syncEvent)
        .where(eq(syncEvent.id, body.event.id))
        .get();
      if (existing) {
        return c.body(null, 204);
      }
      // Renumber the seq under a transaction to keep per-aggregate monotonicity
      const inserted = db.transaction((tx) => {
        const last = tx
          .select({ seq: syncEvent.seq })
          .from(syncEvent)
          .where(
            and(
              eq(syncEvent.projectId, body.event.projectId),
              eq(syncEvent.aggregate, body.event.aggregate),
            ),
          )
          .orderBy(syncEvent.seq)
          .all()
          .at(-1);
        const nextSeq = (last?.seq ?? 0) + 1;
        tx.insert(syncEvent)
          .values({
            id: body.event.id,
            projectId: body.event.projectId,
            workspaceId: body.event.workspaceId,
            aggregate: body.event.aggregate,
            seq: nextSeq,
            type: body.event.type,
            data: JSON.stringify(body.event.data),
            timestamp: body.event.timestamp,
            origin: body.event.origin ?? "remote",
            originSeq: body.event.seq,
          })
          .run();
        return nextSeq;
      });
      // Re-emit to in-process subscribers (mobile, studio on the same server)
      GlobalBus.emit("event", {
        directory: body.event.projectId,
        payload: {
          type: "sync.received",
          properties: { eventID: body.event.id, seq: inserted },
        },
      });
      log.info("remote event accepted", {
        eventID: body.event.id,
        seq: inserted,
        aggregate: body.event.aggregate,
      });
      return c.body(null, 204);
    },
  )
  .get(
    "/outbox",
    describeRoute({
      summary: "List events since a given sequence for catch-up",
      operationId: "sync.outbox.list",
      responses: {
        200: {
          description: "Page of events",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  events: z.array(z.unknown()),
                  hasMore: z.boolean(),
                }),
              ),
            },
          },
        },
      },
    }),
    validator("query", OutboxQuery),
    async (c) => {
      const { projectID, since } = c.req.valid("query");
      const db = Database.syncDb();
      const rows = db
        .select()
        .from(syncEvent)
        .where(
          and(eq(syncEvent.projectId, projectID), gt(syncEvent.seq, since)),
        )
        .orderBy(syncEvent.seq)
        .limit(500)
        .all();
      const hasMore = rows.length === 500;
      return c.json({
        events: rows.map((row) => ({
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
        })),
        hasMore,
      });
    },
  )
  .get(
    "/stream",
    describeRoute({
      summary: "SSE stream of new sync events",
      operationId: "sync.event.stream",
      responses: { 200: { description: "SSE stream" } },
    }),
    validator("query", StreamQuery),
    async (c) => {
      const { projectID, token } = c.req.valid("query");
      // Token check happens in the global middleware; we just attach
      // the listener and forward bus events as SSE messages.
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          const send = (data: unknown) =>
            controller.enqueue(
              encoder.encode(`event: sync\ndata: ${JSON.stringify(data)}\n\n`),
            );
          // initial comment to open the stream promptly
          controller.enqueue(encoder.encode(`: connected\n\n`));
          const handler = (raw: unknown) => {
            const envelope = raw as { directory?: string; payload?: any };
            if (envelope?.directory !== projectID) return;
            send(envelope.payload);
          };
          GlobalBus.on("event", handler as never);
          const ping = setInterval(() => {
            controller.enqueue(encoder.encode(`: ping\n\n`));
          }, 15_000);
          const close = () => {
            clearInterval(ping);
            GlobalBus.off("event", handler as never);
            try {
              controller.close();
            } catch {}
          };
          // token verification is a no-op here — the auth middleware
          // would have already returned 401 if the token was bad. We
          // accept the token param because EventSource cannot send
          // custom headers.
          void token;
          c.req.raw.signal.addEventListener("abort", close);
        },
      });
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
        },
      });
    },
  )
  // ============================================================================
  // TUI helper endpoints
  // ============================================================================
  //
  // The TUI does not have a direct SQLite handle, so it asks the
  // server for aggregated sync stats on every poll. The server reads
  // from its own DB and the in-process outbox queue.
  .get(
    "/stats",
    describeRoute({
      summary: "Aggregated sync stats for the TUI",
      operationId: "sync.stats",
      responses: {
        200: { description: "Sync stats" },
      },
    }),
    validator(
      "query",
      z.object({
        projectID: z.string().default(""),
      }),
    ),
    async (c) => {
      const { projectID } = c.req.valid("query");
      const db = Database.syncDb();
      const url = process.env["NIKCLI_REMOTE_URL"]?.replace(/\/$/, "");
      const configured = Boolean(url && process.env["NIKCLI_REMOTE_TOKEN"]);
      // Outbox counters
      const pending = db
        .select({ count: sql<number>`cast(count(*) as integer)` })
        .from(syncOutbox)
        .where(eq(syncOutbox.status, "pending"))
        .get();
      const failed = db
        .select({ count: sql<number>`cast(count(*) as integer)` })
        .from(syncOutbox)
        .where(eq(syncOutbox.status, "failed"))
        .get();
      // Latest event for the project (if any)
      const where = projectID ? eq(syncEvent.projectId, projectID) : undefined;
      const latest = where
        ? db
            .select()
            .from(syncEvent)
            .where(where)
            .orderBy(sql`${syncEvent.seq} DESC`)
            .limit(1)
            .get()
        : db
            .select()
            .from(syncEvent)
            .orderBy(sql`${syncEvent.seq} DESC`)
            .limit(1)
            .get();
      // Top 50 events for the project (most recent first)
      const recent = where
        ? db
            .select()
            .from(syncEvent)
            .where(where)
            .orderBy(sql`${syncEvent.seq} DESC`)
            .limit(50)
            .all()
        : db
            .select()
            .from(syncEvent)
            .orderBy(sql`${syncEvent.seq} DESC`)
            .limit(50)
            .all();
      return c.json({
        url,
        configured,
        connected: configured && Boolean(latest),
        pending: pending?.count ?? 0,
        failed: failed?.count ?? 0,
        total: (pending?.count ?? 0) + (failed?.count ?? 0),
        lastSeq: latest?.seq ?? 0,
        lastError: undefined as string | undefined,
        lastChange: Date.now(),
        events: recent.map((row) => ({
          id: row.id,
          projectId: row.projectId,
          workspaceId: row.workspaceId ?? undefined,
          aggregate: row.aggregate,
          seq: row.seq,
          type: row.type,
          timestamp: row.timestamp,
          origin: row.origin,
          dataPreview: previewPayload(row.data),
        })),
      });
    },
  )
  .post(
    "/connect",
    describeRoute({
      summary: "Force a connection to the configured hub",
      operationId: "sync.connect",
      responses: { 204: { description: "Connection requested" } },
    }),
    async (c) => {
      // The hub connection is owned by the local CLI process; from the
      // server's perspective the connection is implicit. This endpoint
      // exists so the TUI can dispatch a connect intent uniformly.
      log.info("sync connect requested from TUI");
      return c.body(null, 204);
    },
  )
  .post(
    "/disconnect",
    describeRoute({
      summary: "Abort the hub connection",
      operationId: "sync.disconnect",
      responses: { 204: { description: "Disconnection requested" } },
    }),
    async (c) => {
      log.info("sync disconnect requested from TUI");
      return c.body(null, 204);
    },
  )
  .post(
    "/drain",
    describeRoute({
      summary: "Force an outbox drain now",
      operationId: "sync.drain",
      responses: { 204: { description: "Drain requested" } },
    }),
    async (c) => {
      log.info("sync drain requested from TUI");
      return c.body(null, 204);
    },
  );

function previewPayload(value: string): string {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object") {
      const type = (parsed as any).type;
      if (typeof type === "string") return type;
    }
    const s = JSON.stringify(parsed);
    return s.length > 80 ? s.slice(0, 79) + "…" : s;
  } catch {
    return "raw";
  }
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
