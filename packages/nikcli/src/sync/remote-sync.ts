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
import { Log } from "@/util/log"
import { Database } from "@/database/database"
import { eq } from "drizzle-orm"
import { syncEvent } from "./sync.sql"
import { RemoteSyncClient } from "./remote-client"
import { Outbox } from "./outbox"
import { Sync, type SyncEventRecord } from "./index"

const log = Log.create({ service: "sync.remote" })

export type RemoteSyncOptions = {
  url: string
  token: string
  projectID: string
  drainIntervalMs?: number
  clientId?: string
}

export type RemoteSyncHandle = {
  stop(): Promise<void>
  status(): {
    connected: boolean
    lastSeq: number
    outbox: ReturnType<typeof Outbox.status>
  }
}

export namespace RemoteSync {
  // One handle per (url, projectID): repeated starts (bootstrap + serve +
  // `nikcli sync`) share the same connection instead of stacking emitRaw
  // wrappers and duplicate drain timers.
  const active = new Map<string, { handle: RemoteSyncHandle; url: string }>()

  // Single global emitRaw hook. Each active target gets local events
  // enqueued; the hook is installed once and removed when the last
  // remote sync stops.
  const enqueueTargets = new Set<string>()
  let removeEmitHook: (() => void) | undefined

  function ensureEmitHook() {
    if (removeEmitHook) return
    const originalEmitRaw = Sync.emitRaw
    ;(Sync as any).emitRaw = async (
      projectID: string,
      aggregate: string,
      data: unknown,
      options: {
        workspaceID?: string
        origin?: string
        originSeq?: number
      } = {},
    ) => {
      const isLocal = !options.origin || options.origin === "local"
      const record = await originalEmitRaw(projectID, aggregate, data, options)
      if (isLocal) {
        for (const target of enqueueTargets) {
          try {
            Outbox.enqueue(record.id, target)
          } catch (error) {
            log.warn("outbox enqueue failed", { target, error })
          }
        }
      }
      return record
    }
    removeEmitHook = () => {
      ;(Sync as any).emitRaw = originalEmitRaw
      removeEmitHook = undefined
    }
  }

  /**
   * Resolve a `SyncEventRecord` from the outbox row's `eventId` so it
   * can be pushed to the remote.
   */
  function loadEvent(eventId: string): SyncEventRecord | undefined {
    const db = Database.syncDb()
    const row = db.select().from(syncEvent).where(eq(syncEvent.id, eventId)).get()
    if (!row) return undefined
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
    }
  }

  function safeJson(value: string): unknown {
    try {
      return JSON.parse(value)
    } catch {
      return null
    }
  }

  // Concurrent starts for the same (url, projectID) share the in-flight
  // promise instead of racing past the active check.
  const starting = new Map<string, Promise<RemoteSyncHandle>>()

  export function start(opts: RemoteSyncOptions): Promise<RemoteSyncHandle> {
    const key = `${opts.url}::${opts.projectID}`
    const existing = active.get(key)
    if (existing) return Promise.resolve(existing.handle)
    let inflight = starting.get(key)
    if (!inflight) {
      inflight = doStart(opts, key)
      starting.set(key, inflight)
      const settle = () => {
        if (starting.get(key) === inflight) starting.delete(key)
      }
      inflight.then(settle, settle)
    }
    return inflight
  }

  async function doStart(opts: RemoteSyncOptions, key: string): Promise<RemoteSyncHandle> {
    const clientId = opts.clientId ?? "cli"
    const originTag = `remote:${clientId}`
    const drainInterval = opts.drainIntervalMs ?? 5_000
    let connected = true

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
          })
        } catch (error) {
          log.warn("replaying remote event failed", { error, event: event.id })
        }
      },
      onError: (error) => {
        connected = false
        log.warn("remote sync connection error", { error })
      },
    })

    await client.start()
    log.info("remote sync started", {
      url: opts.url,
      projectID: opts.projectID,
    })

    // Periodic outbox drain
    const drainTimer = setInterval(() => {
      void Outbox.drain(opts.url, async (eventId) => {
        const event = loadEvent(eventId)
        if (!event) return { ok: false, permanent: true, error: "event not found" }
        const ok = await client.push(event)
        if (ok) return { ok: true }
        // 401 / 403 treated as permanent to stop retry storms
        return { ok: false, error: "push failed" }
      }).catch((error) => {
        log.warn("outbox drain failed", { error })
      })
    }, drainInterval)

    // Auto-enqueue: local events recorded via the shared emitRaw hook land
    // in the outbox for this target right after the row is inserted.
    enqueueTargets.add(opts.url)
    ensureEmitHook()

    const handle: RemoteSyncHandle = {
      stop: async () => {
        clearInterval(drainTimer)
        client.stop()
        active.delete(key)
        // Only stop enqueuing for this url when no other project still
        // syncs to it; remove the hook entirely when nothing is active.
        const urlStillUsed = [...active.values()].some((entry) => entry.url === opts.url)
        if (!urlStillUsed) enqueueTargets.delete(opts.url)
        if (active.size === 0) removeEmitHook?.()
        connected = false
        log.info("remote sync stopped")
      },
      status: () => {
        const lastSeq = client["lastSeq"] as number
        return {
          connected,
          lastSeq,
          outbox: Outbox.status(opts.url),
        }
      },
    }

    active.set(key, { handle, url: opts.url })
    return handle
  }
}
