/**
 * Server-side HTTP API for the optional remote sync. Mounted under
 * `/sync/*` by the main server router. Accepts:
 *
 *  - POST /sync/event   — push a single event from a remote CLI
 *  - GET  /sync/outbox  — list events for catch-up replay
 *  - GET  /sync/stream  — SSE stream of new events
 *  - GET  /sync/snapshot/:aggregate/:id — cold-start snapshot fetch
 *
 * All routes accept a `Bearer` token (or `?token=` on SSE) with scope
 * `mobile`, `cli-sync`, or `studio` when bearer auth is used.
 */
import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { z } from "zod"
import { eq, and, gt, sql } from "drizzle-orm"
import { Database } from "@/database/database"
import { MobileAuth } from "@/mobile/auth"
import { syncEvent, syncOutbox } from "@/sync/sync.sql"
import { SyncConfig } from "@/sync/sync-config"
import { GlobalBus } from "@/bus/global"
import { Log } from "@/util/log"
import { configUpdateGlobal } from "./mobile/helpers"

const log = Log.create({ service: "server.sync" })

// Scopes allowed to use the sync surface when a bearer token is presented.
// Operator-level auth paths (basic auth, tailscale identity, unsecured
// loopback server) do not carry a token and pass through.
function syncToken(c: { get?: (key: string) => unknown }): MobileAuth.PublicToken | undefined {
  return (c as any).get?.("mobileAuth") as MobileAuth.PublicToken | undefined
}

// Fixed-window rate limit for event pushes (plan mitigation: a stolen token
// must not be able to flood the log). Keyed by token id, or by the auth
// path ("operator") when no token is involved.
const PUSH_WINDOW_MS = 60_000
const PUSH_LIMIT_PER_WINDOW = 100
const pushWindows = new Map<string, { windowStart: number; count: number }>()

function pushAllowed(identity: string): {
  allowed: boolean
  retryAfterMs: number
} {
  const now = Date.now()
  const window = pushWindows.get(identity)
  if (!window || now - window.windowStart >= PUSH_WINDOW_MS) {
    // Lazy cleanup: drop stale windows so the map stays bounded.
    if (pushWindows.size > 1_000) {
      for (const [key, value] of pushWindows) {
        if (now - value.windowStart >= PUSH_WINDOW_MS) pushWindows.delete(key)
      }
    }
    pushWindows.set(identity, { windowStart: now, count: 1 })
    return { allowed: true, retryAfterMs: 0 }
  }
  if (window.count >= PUSH_LIMIT_PER_WINDOW) {
    return {
      allowed: false,
      retryAfterMs: window.windowStart + PUSH_WINDOW_MS - now,
    }
  }
  window.count++
  return { allowed: true, retryAfterMs: 0 }
}

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
})

const OutboxQuery = z.object({
  projectID: z.string(),
  since: z.coerce.number().int().nonnegative().default(0),
})

const StreamQuery = z.object({
  projectID: z.string(),
  token: z.string(),
})

export const SyncRoutes = new Hono()
  // Scope enforcement: a bearer-authenticated caller must hold a sync-capable
  // scope. Tokens are verified by the server-level auth middleware; this
  // narrows what a valid-but-mobile token may reach.
  .use("*", async (c, next) => {
    const token = syncToken(c)
    if (token && !MobileAuth.SYNC_SCOPES.has((token.scope ?? "mobile") as MobileAuth.Scope)) {
      log.warn("sync access denied: insufficient scope", {
        tokenID: token.id,
        scope: token.scope,
        path: c.req.path,
      })
      return c.text("Forbidden: sync requires a mobile, cli-sync, or studio token", 403)
    }
    return next()
  })
  .post(
    "/event",
    describeRoute({
      summary: "Push a sync event from a remote CLI",
      operationId: "sync.event.push",
      responses: {
        204: { description: "Event accepted" },
        400: { description: "Invalid payload" },
        401: { description: "Unauthorized" },
        429: { description: "Rate limit exceeded" },
      },
    }),
    validator("json", SyncEventPayload),
    async (c) => {
      const token = syncToken(c)
      const identity = token?.id ?? "operator"
      const rate = pushAllowed(identity)
      if (!rate.allowed) {
        log.warn("sync push rate limited", { identity, path: c.req.path })
        c.header("retry-after", String(Math.ceil(rate.retryAfterMs / 1000)))
        return c.text("Rate limit exceeded", 429)
      }

      const body = c.req.valid("json")
      const db = Database.syncDb()
      // Idempotency: skip if the event id already exists
      const existing = db.select({ id: syncEvent.id }).from(syncEvent).where(eq(syncEvent.id, body.event.id)).get()
      if (existing) {
        return c.body(null, 204)
      }
      // Renumber the seq under a transaction to keep per-aggregate monotonicity
      const inserted = db.transaction((tx) => {
        const last = tx
          .select({ seq: syncEvent.seq })
          .from(syncEvent)
          .where(and(eq(syncEvent.projectId, body.event.projectId), eq(syncEvent.aggregate, body.event.aggregate)))
          .orderBy(syncEvent.seq)
          .all()
          .at(-1)
        const nextSeq = (last?.seq ?? 0) + 1
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
          .run()
        return nextSeq
      })
      // Re-emit to in-process subscribers (mobile, studio on the same server)
      GlobalBus.emit("event", {
        directory: body.event.projectId,
        payload: {
          type: "sync.received",
          properties: { eventID: body.event.id, seq: inserted },
        },
      })
      // Audit trail: who pushed what (plan mitigation for stolen tokens).
      log.info("remote event accepted", {
        eventID: body.event.id,
        seq: inserted,
        aggregate: body.event.aggregate,
        type: body.event.type,
        tokenID: token?.id ?? "operator",
        tokenName: token?.name,
      })
      return c.body(null, 204)
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
      const { projectID, since } = c.req.valid("query")
      const db = Database.syncDb()
      const rows = db
        .select()
        .from(syncEvent)
        .where(and(eq(syncEvent.projectId, projectID), gt(syncEvent.seq, since)))
        .orderBy(syncEvent.seq)
        .limit(500)
        .all()
      const hasMore = rows.length === 500
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
      })
    },
  )
  .get(
    "/snapshot/:aggregateID",
    describeRoute({
      summary: "Cold-start projection snapshot for an aggregate",
      description:
        "Returns the snapshot-backed projected state and last sequence number for a workspace (wrk_…) or session (ses_…) aggregate, so a client can restore without replaying the full event log.",
      operationId: "sync.snapshot.get",
      responses: {
        200: {
          description: "Projected state",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  lastSeq: z.number().int(),
                  state: z.unknown(),
                }),
              ),
            },
          },
        },
        400: { description: "Unsupported aggregate kind" },
      },
    }),
    validator("param", z.object({ aggregateID: z.string() })),
    validator("query", z.object({ projectID: z.string() })),
    async (c) => {
      const { aggregateID } = c.req.valid("param")
      const { projectID } = c.req.valid("query")
      const { SyncProjection } = await import("@/sync/projection")
      const result = await SyncProjection.byAggregate(projectID, aggregateID)
      if (!result) return c.text("Unsupported aggregate kind", 400)
      return c.json(result)
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
      const { projectID, token } = c.req.valid("query")
      // Token check happens in the global middleware; we just attach
      // the listener and forward bus events as SSE messages.
      let close: (() => void) | undefined
      const abortHandler = () => close?.()
      const stream = new ReadableStream<Uint8Array>({
        cancel() {
          close?.()
        },
        start(controller) {
          const encoder = new TextEncoder()
          let closed = false
          const send = (data: unknown) => {
            if (closed) return
            try {
              controller.enqueue(encoder.encode(`event: sync\ndata: ${JSON.stringify(data)}\n\n`))
            } catch {
              close?.()
            }
          }
          // initial comment to open the stream promptly
          controller.enqueue(encoder.encode(`: connected\n\n`))
          const handler = (raw: unknown) => {
            const envelope = raw as { directory?: string; payload?: any }
            if (envelope?.directory !== projectID) return
            send(envelope.payload)
          }
          GlobalBus.on("event", handler as never)
          const ping = setInterval(() => {
            if (closed) return
            try {
              controller.enqueue(encoder.encode(`: ping\n\n`))
            } catch {
              close?.()
            }
          }, 15_000)
          close = () => {
            if (closed) return
            closed = true
            clearInterval(ping)
            GlobalBus.off("event", handler as never)
            c.req.raw.signal.removeEventListener("abort", abortHandler)
            try {
              controller.close()
            } catch {}
          }
          // token verification is a no-op here — the auth middleware
          // would have already returned 401 if the token was bad. We
          // accept the token param because EventSource cannot send
          // custom headers.
          void token
          c.req.raw.signal.addEventListener("abort", abortHandler)
        },
      })
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
        },
      })
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
      const { projectID } = c.req.valid("query")
      const db = Database.syncDb()
      const remote = await SyncConfig.resolve()
      const url = remote.url
      const configured = remote.configured
      const { RemoteSync } = await import("@/sync/remote-sync")
      const connected = configured && Boolean(url && RemoteSync.isActive({ url }))
      const lastError = formatHubError(url ? RemoteSync.lastHubError(url) : undefined)
      if (configured && remote.autostart && url && remote.token && !connected) {
        const { SyncCliInit } = await import("@/sync/cli-init")
        void SyncCliInit.startForAllProjects({
          url,
          token: remote.token,
        }).catch((error) => {
          log.warn("sync autostart failed", { error })
        })
      }
      // Outbox counters
      const pending = db
        .select({ count: sql<number>`cast(count(*) as integer)` })
        .from(syncOutbox)
        .where(eq(syncOutbox.status, "pending"))
        .get()
      const failed = db
        .select({ count: sql<number>`cast(count(*) as integer)` })
        .from(syncOutbox)
        .where(eq(syncOutbox.status, "failed"))
        .get()
      const filterProjectID = await resolveStatsProjectID(projectID)
      // Latest event for the project (if any)
      const where = filterProjectID ? eq(syncEvent.projectId, filterProjectID) : undefined
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
            .get()
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
            .all()
      return c.json({
        url,
        configured,
        source: remote.source,
        connected,
        pending: pending?.count ?? 0,
        failed: failed?.count ?? 0,
        total: (pending?.count ?? 0) + (failed?.count ?? 0),
        lastSeq: latest?.seq ?? 0,
        lastError,
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
      })
    },
  )
  .post(
    "/config",
    describeRoute({
      summary: "Save the remote hub settings to the global config file",
      description:
        "Persists `sync.url` / `sync.token` in the global nikcli.json so the TUI can configure the hub without env vars. NIKCLI_REMOTE_URL / NIKCLI_REMOTE_TOKEN still override the saved values. When the result is fully configured, the hub connection is started immediately.",
      operationId: "sync.config.set",
      responses: {
        200: {
          description: "Resolved sync configuration after the save",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  configured: z.boolean(),
                  url: z.string().optional(),
                  source: z.enum(["env", "config"]).optional(),
                  started: z.boolean(),
                  error: z.string().optional(),
                }),
              ),
            },
          },
        },
        400: { description: "Invalid hub URL" },
      },
    }),
    validator(
      "json",
      z.object({
        url: z.string(),
        token: z.string().optional().describe("Omit to keep the token already saved in the config file"),
        autostart: z.boolean().optional(),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json")
      const url = normalizeHubUrl(body.url)
      if (!url) return c.text("Invalid hub URL", 400)
      const patch: {
        sync: { url: string; token?: string; autostart?: boolean }
      } = { sync: { url } }
      if (body.token) patch.sync.token = body.token
      if (body.autostart !== undefined) patch.sync.autostart = body.autostart
      else patch.sync.autostart = true
      await configUpdateGlobal(patch)
      SyncConfig.invalidate()
      const resolved = await SyncConfig.resolve()
      let started = false
      let error: string | undefined
      if (resolved.configured) {
        try {
          const { SyncCliInit } = await import("@/sync/cli-init")
          const result = await SyncCliInit.startForAllProjects({
            url: resolved.url!,
            token: resolved.token!,
          })
          started = result.count > 0
        } catch (err) {
          error = err instanceof Error ? err.message : String(err)
        }
      }
      log.info("sync config saved from TUI", {
        url,
        configured: resolved.configured,
        started,
      })
      return c.json({
        configured: resolved.configured,
        url: resolved.url,
        source: resolved.source,
        started,
        error,
      })
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
      log.info("sync connect requested from TUI")
      const resolved = await SyncConfig.resolve()
      if (resolved.configured) {
        const { SyncCliInit } = await import("@/sync/cli-init")
        await SyncCliInit.startForAllProjects({
          url: resolved.url!,
          token: resolved.token!,
        }).catch((error) => {
          log.warn("sync connect failed", { error })
        })
      }
      return c.body(null, 204)
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
      log.info("sync disconnect requested from TUI")
      return c.body(null, 204)
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
      log.info("sync drain requested from TUI")
      return c.body(null, 204)
    },
  )

function formatHubError(error: string | undefined): string | undefined {
  if (!error) return undefined
  if (error.includes("401")) {
    return `${error} — check the token is valid on the hub`
  }
  return error
}

/** Map a TUI directory path to the git-derived project id used in sync_event. */
async function resolveStatsProjectID(raw: string): Promise<string> {
  if (!raw) return ""
  if (!raw.includes("/") && !raw.includes("\\")) return raw
  try {
    const { Instance } = await import("@/project/instance")
    if (!Instance.has(raw)) return ""
    return await Instance.provide({
      directory: raw,
      fn: () => Instance.project.id,
    })
  } catch {
    return ""
  }
}

/** Accepts values with or without a scheme/trailing slash; https by default. */
function normalizeHubUrl(raw: string): string | undefined {
  let value = raw.trim()
  if (!value) return undefined
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`
  try {
    const url = new URL(value)
    return (url.origin + url.pathname).replace(/\/+$/, "")
  } catch {
    return undefined
  }
}

function previewPayload(value: string): string {
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === "object") {
      const type = (parsed as any).type
      if (typeof type === "string") return type
    }
    const s = JSON.stringify(parsed)
    return s.length > 80 ? s.slice(0, 79) + "…" : s
  } catch {
    return "raw"
  }
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}
