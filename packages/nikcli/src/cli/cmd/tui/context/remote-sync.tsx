/**
 * RemoteSync context — reactive view of the unified sync engine.
 *
 * Reads the local DB outbox and (optionally) the events emitted by the
 * server-side `RemoteSync` instance. Provides a single source of truth
 * for the TUI to render connection state, outbox depth, last-seen
 * sequence, and the most recent events.
 *
 * The context is intentionally cheap: a 2-second poll against the
 * server `/sync/stats` endpoint, which returns aggregated counters and
 * the latest event preview. The server-side push of remote events
 * flows through the regular `/event` SSE channel, so we do not need a
 * second subscription here.
 */
import { createStore, produce } from "solid-js/store"
import { createMemo, onCleanup, onMount } from "solid-js"
import { createSimpleContext } from "./helper"
import { useSDK } from "./sdk"

export type SyncAggregateKind = "workspace" | "session" | "permission" | "question" | "global"

export type SyncEventSummary = {
  id: string
  projectId: string
  workspaceId?: string
  aggregate: string
  aggregateKind: SyncAggregateKind
  seq: number
  type: string
  timestamp: number
  origin: "local" | "remote"
  /** Truncated JSON of the event payload for the TUI log */
  preview: string
}

export type RemoteSyncStatus = {
  /** Configured via NIKCLI_REMOTE_URL + NIKCLI_REMOTE_TOKEN. */
  configured: boolean
  /** Currently connected to the hub. */
  connected: boolean
  /** Hub URL (no trailing slash) or `undefined` if not configured. */
  url: string | undefined
  /** Outbox counters */
  pending: number
  failed: number
  total: number
  /** Highest sequence number seen locally (or 0). */
  lastSeq: number
  /** Origin of the most recent event (`local` or `remote`). */
  lastOrigin: "local" | "remote" | undefined
  /** When the connection last changed state. */
  lastChange: number
  /** Error message from the last failed reconnect, if any. */
  lastError: string | undefined
  /** Most recent events (newest first, capped at MAX_EVENTS). */
  events: SyncEventSummary[]
}

const EMPTY_STATUS: RemoteSyncStatus = {
  configured: false,
  connected: false,
  url: undefined,
  pending: 0,
  failed: 0,
  total: 0,
  lastSeq: 0,
  lastOrigin: undefined,
  lastChange: Date.now(),
  lastError: undefined,
  events: [],
}

function classifyAggregate(aggregate: string): SyncAggregateKind {
  if (aggregate.startsWith("wrk")) return "workspace"
  if (aggregate.startsWith("ses")) return "session"
  if (aggregate.startsWith("per")) return "permission"
  if (aggregate.startsWith("que")) return "question"
  return "global"
}

export const { use: useRemoteSync, provider: RemoteSyncProvider } = createSimpleContext({
  name: "RemoteSync",
  init: () => {
    const sdk = useSDK()
    const [status, setStatus] = createStore<RemoteSyncStatus>({
      ...EMPTY_STATUS,
    })

    let pollTimer: ReturnType<typeof setInterval> | undefined
    let cancelled = false

    /**
     * Direct fetch against the same base URL the SDK uses. We use this
     * for the `/sync/*` endpoints that are not part of the generated
     * SDK yet (the SDK is regenerated from `server.ts` separately).
     */
    async function syncFetch<T>(path: string, init?: RequestInit): Promise<T | undefined> {
      const base = (sdk as any).url as string | undefined
      if (!base) return undefined
      try {
        const res = await fetch(`${base.replace(/\/$/, "")}${path}`, {
          ...init,
          signal: AbortSignal.timeout(10_000),
          headers: {
            "content-type": "application/json",
            ...(init?.headers ?? {}),
          },
        })
        if (!res.ok) return undefined
        return (await res.json()) as T
      } catch {
        return undefined
      }
    }

    async function poll() {
      if (cancelled) return
      try {
        const projectID = sdk.directory
        const stats = await syncFetch<{
          url?: string
          configured: boolean
          connected: boolean
          pending: number
          failed: number
          total: number
          lastSeq: number
          lastError?: string
          lastChange: number
          events: Array<{
            id: string
            projectId: string
            workspaceId?: string
            aggregate: string
            seq: number
            type: string
            timestamp: number
            origin: string
            dataPreview: string
          }>
        }>(`/sync/stats?projectID=${encodeURIComponent(projectID ?? "")}`)

        if (!stats) {
          setStatus(
            produce((s) => {
              s.configured = false
              s.connected = false
            }),
          )
          return
        }

        setStatus(
          produce((s) => {
            s.configured = stats.configured
            s.connected = stats.connected
            s.url = stats.url
            s.pending = stats.pending
            s.failed = stats.failed
            s.total = stats.total
            s.lastSeq = stats.lastSeq
            s.lastError = stats.lastError
            s.lastChange = stats.lastChange
            s.events = stats.events.map((e) => ({
              id: e.id,
              projectId: e.projectId,
              workspaceId: e.workspaceId,
              aggregate: e.aggregate,
              aggregateKind: classifyAggregate(e.aggregate),
              seq: e.seq,
              type: e.type,
              timestamp: e.timestamp,
              origin: e.origin?.startsWith("remote") ? "remote" : "local",
              preview: e.dataPreview,
            }))
            if (s.events.length > 0) {
              s.lastOrigin = s.events[0].origin
            }
          }),
        )
      } catch (error) {
        setStatus(
          produce((s) => {
            s.lastError = error instanceof Error ? error.message : String(error)
            s.lastChange = Date.now()
          }),
        )
      }
    }

    async function connect() {
      const projectID = sdk.directory
      await syncFetch(`/sync/connect?projectID=${encodeURIComponent(projectID ?? "")}`, { method: "POST" })
      await poll()
    }

    async function disconnect() {
      const projectID = sdk.directory
      await syncFetch(`/sync/disconnect?projectID=${encodeURIComponent(projectID ?? "")}`, { method: "POST" })
      await poll()
    }

    async function drain() {
      const projectID = sdk.directory
      await syncFetch(`/sync/drain?projectID=${encodeURIComponent(projectID ?? "")}`, { method: "POST" })
      await poll()
    }

    onMount(() => {
      void poll()
      pollTimer = setInterval(poll, 2000)
    })

    onCleanup(() => {
      cancelled = true
      if (pollTimer) clearInterval(pollTimer)
    })

    const isConfigured = createMemo(() => status.configured)
    const isConnected = createMemo(() => status.connected)

    return {
      status,
      isConfigured,
      isConnected,
      connect,
      disconnect,
      drain,
      refresh: poll,
    }
  },
})
