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
 *  1. Subscribe to remote events via the injected `RemoteTransport`.
 *  2. Periodically drain the local outbox via the injected `Scheduler`.
 *  3. Subscribe to `Sync.onEmit` so local events are enqueued for push.
 *
 * The transport and scheduler are Adapters — the production wiring uses
 * `createHttpRemoteTransport` + `realScheduler`, while tests inject
 * `createInMemoryRemoteTransport` + `createInMemoryScheduler`.
 */
import { Log } from "@/util/log"
import { Database } from "@/database/database"
import { eq } from "drizzle-orm"
import { syncEvent } from "./sync.sql"
import { Outbox } from "./outbox"
import { Sync, type SyncEventRecord } from "./index"
import { createHttpRemoteTransport, realScheduler, type RemoteTransport, type Scheduler } from "./transport"

const log = Log.create({ service: "sync.remote" })

export type RemoteSyncOptions = {
  url: string
  token: string
  projectID: string
  drainIntervalMs?: number
  clientId?: string
  /** Override the transport for testing. Defaults to the HTTP+EventSource
   *  client built by `createHttpRemoteTransport`. */
  transport?: RemoteTransport
  /** Override the scheduler/clock for testing. Defaults to `realScheduler`. */
  scheduler?: Scheduler
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
  const active = new Map<string, { handle: RemoteSyncHandle; url: string }>()
  const enqueueTargets = new Set<string>()
  const hubErrors = new Map<string, string>()
  let removeEmitHook: (() => void) | undefined

  function normalizeUrl(url: string) {
    return url.replace(/\/$/, "")
  }

  function noteHubError(url: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    hubErrors.set(normalizeUrl(url), message)
  }

  function clearHubError(url: string) {
    hubErrors.delete(normalizeUrl(url))
  }

  function ensureEmitHook() {
    if (removeEmitHook) return
    const unsubscribe = Sync.onEmit((record, meta) => {
      if (meta.origin !== "local") return
      for (const target of enqueueTargets) {
        try {
          Outbox.enqueue(record.id, target)
        } catch (error) {
          log.warn("outbox enqueue failed", { target, error })
        }
      }
    })
    removeEmitHook = () => {
      unsubscribe()
      removeEmitHook = undefined
    }
  }

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

  const starting = new Map<string, Promise<RemoteSyncHandle>>()

  /** Whether a live remote-sync session is running for the given hub/project. */
  export function isActive(input?: { url?: string; projectID?: string }): boolean {
    if (input?.url && input.projectID) {
      return active.has(`${normalizeUrl(input.url)}::${input.projectID}`)
    }
    if (input?.url) {
      const normalized = normalizeUrl(input.url)
      return [...active.values()].some((entry) => entry.url === normalized)
    }
    if (input?.projectID) {
      return [...active.keys()].some((key) => key.endsWith(`::${input.projectID}`))
    }
    return active.size > 0
  }

  /** Last hub transport error for the URL, if any (e.g. HTTP 403). */
  export function lastHubError(url: string): string | undefined {
    return hubErrors.get(normalizeUrl(url))
  }

  export function start(opts: RemoteSyncOptions): Promise<RemoteSyncHandle> {
    const normalizedUrl = normalizeUrl(opts.url)
    const key = `${normalizedUrl}::${opts.projectID}`
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
    const hubUrl = normalizeUrl(opts.url)
    const originTag = `remote:${opts.clientId ?? "cli"}`
    const drainInterval = opts.drainIntervalMs ?? 5_000
    let connected = true
    let lastSeq = 0

    const transport: RemoteTransport =
      opts.transport ??
      createHttpRemoteTransport({
        url: opts.url,
        token: opts.token,
        projectID: opts.projectID,
        onError: (error) => {
          connected = false
          log.warn("remote sync connection error", { error })
        },
      })

    const scheduler: Scheduler = opts.scheduler ?? realScheduler

    // Catch-up: pull everything since 0 (the server already filters by
    // projectID and the local outbox will dedupe).
    try {
      let since = 0
      for (;;) {
        const page = await transport.pullBacklog(since)
        for (const event of page.events) {
          since = Math.max(since, event.seq)
          lastSeq = Math.max(lastSeq, event.seq)
          try {
            await Sync.emitRaw(event.projectId, event.aggregate, event.data, {
              workspaceID: event.workspaceId,
              origin: originTag,
              originSeq: event.seq,
            })
          } catch (error) {
            log.warn("replaying remote event failed", {
              error,
              event: event.id,
            })
          }
        }
        if (!page.hasMore) break
      }
      clearHubError(hubUrl)
    } catch (error) {
      noteHubError(hubUrl, error)
      log.warn("initial catch-up failed", { error })
    }

    transport.subscribe(async (event) => {
      try {
        await Sync.emitRaw(event.projectId, event.aggregate, event.data, {
          workspaceID: event.workspaceId,
          origin: originTag,
          originSeq: event.seq,
        })
      } catch (error) {
        log.warn("replaying remote event failed", { error, event: event.id })
      }
    })

    log.info("remote sync started", {
      url: opts.url,
      projectID: opts.projectID,
    })

    const drainHandle = scheduler.interval(() => {
      void Outbox.drain(hubUrl, async (eventId) => {
        const event = loadEvent(eventId)
        if (!event) return { ok: false, permanent: true, error: "event not found" }
        const outcome = await transport.push(event)
        if (outcome.ok) {
          clearHubError(hubUrl)
          return { ok: true }
        }
        if (outcome.error) noteHubError(hubUrl, outcome.error)
        return {
          ok: false,
          permanent: outcome.permanent === true,
          error: outcome.error,
        }
      }).catch((error) => {
        log.warn("outbox drain failed", { error })
      })
    }, drainInterval)

    enqueueTargets.add(hubUrl)
    ensureEmitHook()

    const handle: RemoteSyncHandle = {
      stop: async () => {
        drainHandle.clear()
        transport.close()
        active.delete(key)
        const urlStillUsed = [...active.values()].some((entry) => entry.url === hubUrl)
        if (!urlStillUsed) {
          enqueueTargets.delete(hubUrl)
          hubErrors.delete(hubUrl)
        }
        if (active.size === 0) removeEmitHook?.()
        connected = false
        log.info("remote sync stopped")
      },
      status: () => ({
        connected,
        lastSeq,
        outbox: Outbox.status(opts.url),
      }),
    }

    active.set(key, { handle, url: hubUrl })
    return handle
  }
}
