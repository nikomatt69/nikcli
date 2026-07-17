/**
 * RemoteTransport — the wire seam for the optional hub-and-spoke sync.
 *
 * `RemoteSync` orchestrates subscription, push, drain timers, and the
 * `Sync.onEmit` hook. None of that needs to know about `fetch` or
 * `EventSource` — the contract below captures the minimal capabilities
 * the orchestrator depends on:
 *
 *   - `pullBacklog(since)` — fetch missed events from the server
 *   - `subscribe(onEvent)` — receive live events; returns an unsubscribe
 *   - `push(event)` — POST a single event
 *
 * Two adapters are wired by default:
 *   - `HttpRemoteTransport` (the existing fetch + EventSource client,
 *     unchanged behaviour, isolated behind the seam)
 *   - `InMemoryRemoteTransport` (test fake)
 *
 * A second seam, `Scheduler`, abstracts `setInterval`/`setTimeout`/`Date.now`
 * so the drain loop can be tested without real timers. `InMemoryScheduler`
 * ticks deterministically when the test calls `tick()`.
 */
import { Log } from "@/util/log"
import type { SyncEventRecord } from "./index"
import { EventSource as EventSourcePolyfill } from "eventsource"

const log = Log.create({ service: "sync.remote.transport" })

export type BacklogResponse = {
  events: SyncEventRecord[]
  hasMore: boolean
}

export type PushOutcome = { ok: true } | { ok: false; permanent?: boolean; error?: string }

export type RemoteTokenResolver = () => Promise<string | undefined>

export interface RemoteTransport {
  /** Fetch missed events with seq > `since`. May be called multiple
   *  times until `hasMore` is false. */
  pullBacklog(since: number): Promise<BacklogResponse>
  /** Subscribe to live events. Return value unsubscribes. */
  subscribe(onEvent: (event: SyncEventRecord) => void | Promise<void>): () => void
  /** Push a single event. The shape `PushOutcome` lets adapters signal
   *  permanent failures (e.g. HTTP 401) so the outbox stops retrying. */
  push(event: SyncEventRecord): Promise<PushOutcome>
  /** Close the connection and any timers. */
  close(): void
}

export interface Scheduler {
  /** Schedule a recurring task; returns a handle for `clear`. */
  interval(cb: () => void, periodMs: number): SchedulerHandle
  /** One-shot timer. */
  timeout(cb: () => void, delayMs: number): SchedulerHandle
  /** "Now" in test-friendly time. Defaults to `Date.now`. */
  now(): number
}

export type SchedulerHandle = {
  clear(): void
}

function resolveEventSource(eventSourceImpl?: typeof EventSource): typeof EventSource {
  if (eventSourceImpl) return eventSourceImpl
  const native = (globalThis as { EventSource?: typeof EventSource }).EventSource
  if (native) return native
  return EventSourcePolyfill as unknown as typeof EventSource
}

// ---------- HTTP + EventSource adapter (default) ----------

export type HttpRemoteTransportOptions = {
  url: string
  token: string
  resolveToken?: RemoteTokenResolver
  projectID: string
  onError?: (error: unknown) => void
  fetchImpl?: typeof fetch
  eventSourceImpl?: typeof EventSource
}

export function createHttpRemoteTransport(opts: HttpRemoteTransportOptions): RemoteTransport {
  const fetchImpl = opts.fetchImpl ?? fetch
  const EventSourceImpl = resolveEventSource(opts.eventSourceImpl)

  const base = opts.url.replace(/\/$/, "")
  let token = opts.token
  let refreshingToken: Promise<boolean> | undefined
  let source: EventSource | undefined
  const subscribers = new Set<(event: SyncEventRecord) => void | Promise<void>>()

  async function refreshToken(failedToken: string): Promise<boolean> {
    if (token !== failedToken) return true
    if (!opts.resolveToken) return false
    if (!refreshingToken) {
      refreshingToken = opts
        .resolveToken()
        .then((next) => {
          if (!next || next === failedToken) return false
          token = next
          return true
        })
        .finally(() => {
          refreshingToken = undefined
        })
    }
    return refreshingToken
  }

  function withToken(headers: HeadersInit | undefined, value: string): Headers {
    const next = new Headers(headers)
    next.set("authorization", `Bearer ${value}`)
    return next
  }

  async function fetchWithToken(input: string, init: RequestInit = {}): Promise<Response> {
    const failedToken = token
    const first = await fetchImpl(input, {
      ...init,
      headers: withToken(init.headers, failedToken),
    })
    if (first.status !== 401 || !(await refreshToken(failedToken))) return first
    return fetchImpl(input, {
      ...init,
      headers: withToken(init.headers, token),
    })
  }

  function fanout(event: SyncEventRecord) {
    for (const sub of subscribers) {
      Promise.resolve(sub(event)).catch((error) => log.warn("remote subscribe handler failed", { error }))
    }
  }

  async function pullBacklog(since: number): Promise<BacklogResponse> {
    const url = new URL(`${base}/sync/outbox`)
    url.searchParams.set("projectID", opts.projectID)
    url.searchParams.set("since", String(since))
    const res = await fetchWithToken(url.toString(), {
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) throw new Error(`backlog HTTP ${res.status}`)
    return (await res.json()) as BacklogResponse
  }

  function openSource(): void {
    const streamUrl = new URL(`${base}/sync/stream`)
    streamUrl.searchParams.set("projectID", opts.projectID)
    streamUrl.searchParams.set("token", token)
    const sourceToken = token
    const nextSource = new EventSourceImpl!(streamUrl.toString())
    source = nextSource
    // The server emits `event: sync` on the stream
    // (server/routes/sync.ts), so listen for that event name.
    nextSource.addEventListener("sync", (e: MessageEvent) => {
      try {
        const event = JSON.parse(e.data) as SyncEventRecord
        fanout(event)
      } catch (error) {
        opts.onError?.(error)
      }
    })
    nextSource.addEventListener("error", (event: Event) => {
      opts.onError?.(event)
      const code = (event as Event & { code?: unknown }).code
      if (code !== 401 || source !== nextSource) return
      nextSource.close()
      source = undefined
      void refreshToken(sourceToken)
        .then((changed) => {
          if (changed && subscribers.size > 0 && !source) openSource()
        })
        .catch((error) => opts.onError?.(error))
    })
  }

  function subscribe(onEvent: (event: SyncEventRecord) => void | Promise<void>): () => void {
    subscribers.add(onEvent)
    if (!source) openSource()
    return () => {
      subscribers.delete(onEvent)
      if (subscribers.size === 0 && source) {
        source.close()
        source = undefined
      }
    }
  }

  async function push(event: SyncEventRecord): Promise<PushOutcome> {
    try {
      const res = await fetchWithToken(`${base}/sync/event`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ event, projectID: opts.projectID }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) {
        return {
          ok: false,
          permanent: res.status === 401 || res.status === 403,
          error: `HTTP ${res.status}`,
        }
      }
      return { ok: true }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  }

  function close(): void {
    if (source) {
      source.close()
      source = undefined
    }
    subscribers.clear()
  }

  return { pullBacklog, subscribe, push, close }
}

// ---------- Real scheduler ----------

export const realScheduler: Scheduler = {
  interval(cb, periodMs) {
    const id = setInterval(cb, periodMs)
    return { clear: () => clearInterval(id) }
  },
  timeout(cb, delayMs) {
    const id = setTimeout(cb, delayMs)
    return { clear: () => clearTimeout(id) }
  },
  now() {
    return Date.now()
  },
}

// ---------- In-memory scheduler (test) ----------

export type InMemorySchedulerOptions = {
  initialNow?: number
}

export function createInMemoryScheduler(opts: InMemorySchedulerOptions = {}): Scheduler & {
  tick(ms: number): void
  pendingCount(): number
} {
  let now = opts.initialNow ?? 0
  type Pending = {
    id: number
    at: number
    cb: () => void
    periodicMs?: number
  }
  const tasks = new Map<number, Pending>()
  let nextId = 1

  // Track every distinct callback that was ever scheduled so clear()
  // can sweep pending AND already-rescheduled tasks of that callback.
  const cbIds = new WeakMap<() => void, Set<number>>()
  function track(cb: () => void, id: number) {
    let set = cbIds.get(cb)
    if (!set) {
      set = new Set()
      cbIds.set(cb, set)
    }
    set.add(id)
  }
  function untrackAll(cb: () => void) {
    const set = cbIds.get(cb)
    if (!set) return
    for (const id of set) tasks.delete(id)
    cbIds.delete(cb)
  }
  function schedule(cb: () => void, delayMs: number, periodicMs?: number) {
    const id = nextId++
    tasks.set(id, { id, at: now + delayMs, cb, periodicMs })
    return id
  }
  function tick(ms: number) {
    const end = now + ms
    for (;;) {
      const due: Pending[] = []
      for (const t of tasks.values()) if (t.at <= end) due.push(t)
      if (due.length === 0) break
      due.sort((a, b) => a.at - b.at)
      const next = due[0]
      tasks.delete(next.id)
      now = next.at
      try {
        next.cb()
      } catch (error) {
        log.warn("scheduled task threw", { error })
      }
      if (next.periodicMs !== undefined) {
        const id = nextId++
        tasks.set(id, {
          id,
          at: next.at + next.periodicMs,
          cb: next.cb,
          periodicMs: next.periodicMs,
        })
        // Re-register the rescheduled successor with the same callback
        // tracker so `clear()` sweeps it too.
        const set = cbIds.get(next.cb)
        if (set) set.add(id)
      }
    }
    now = end
  }
  return {
    interval(cb, periodMs) {
      const id = schedule(cb, periodMs, periodMs)
      track(cb, id)
      return { clear: () => untrackAll(cb) }
    },
    timeout(cb, delayMs) {
      const id = schedule(cb, delayMs)
      track(cb, id)
      return { clear: () => untrackAll(cb) }
    },
    now() {
      return now
    },
    tick,
    pendingCount: () => tasks.size,
  }
}

// ---------- In-memory transport (test) ----------

export function createInMemoryRemoteTransport(): RemoteTransport & {
  /** Program events the transport will deliver to subscribers and/or
   *  the backlog reader. */
  enqueue(event: SyncEventRecord): void
  /** Read all events the orchestrator tried to push. */
  pushed: SyncEventRecord[]
  /** Override the next `push` outcome (e.g. simulate 401/503). */
  setNextPush(outcome: PushOutcome): void
  reset(): void
} {
  const queue: SyncEventRecord[] = []
  const pushed: SyncEventRecord[] = []
  const subscribers = new Set<(event: SyncEventRecord) => void | Promise<void>>()
  let nextPush: PushOutcome | undefined
  let since = 0

  return {
    async pullBacklog(s: number) {
      const filtered = queue.filter((e) => e.seq > s).sort((a, b) => a.seq - b.seq)
      since = Math.max(since, ...filtered.map((e) => e.seq))
      return { events: filtered, hasMore: false }
    },
    subscribe(onEvent) {
      subscribers.add(onEvent)
      return () => subscribers.delete(onEvent)
    },
    async push(event) {
      if (nextPush) {
        const outcome = nextPush
        nextPush = undefined
        return outcome
      }
      pushed.push(event)
      return { ok: true }
    },
    close() {
      subscribers.clear()
    },
    enqueue(event: SyncEventRecord) {
      queue.push(event)
      for (const sub of subscribers) Promise.resolve(sub(event))
    },
    setNextPush(outcome: PushOutcome) {
      nextPush = outcome
    },
    reset() {
      queue.length = 0
      pushed.length = 0
      nextPush = undefined
      subscribers.clear()
      since = 0
    },
    pushed,
  } as ReturnType<typeof createInMemoryRemoteTransport>
}
