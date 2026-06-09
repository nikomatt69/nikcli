/**
 * Loops — runtime engine for the TUI.
 *
 * The TUI delegates the autonomous run to the headless engine via the SDK
 * (see `sdk.ts`), then watches bus events to update the reactive store and
 * attribute a diff to the run for the history view. The engine itself records
 * the canonical run/server-side; the local store is a fast cache for the
 * sidebar + per-stage diff totals.
 */
import type { TuiPluginApi } from "@nikcli-ai/plugin/tui"
import { createStore } from "solid-js/store"
import { LoopApi, subscribeLoopEvents, type LoopDefinition, type LoopRuntime, type LoopRuntimeStatus } from "./sdk"
import * as Store from "./store"

export type { LoopDefinition, LoopRuntime, LoopRuntimeStatus } from "./sdk"

const EMPTY: LoopRuntime = { status: "idle", runs: 0 }
const [runtimes, setRuntimes] = createStore<Record<string, LoopRuntime>>({})
const sessionByLoop: Map<string, string> = new Map()
const tombstones = new Set<string>()

export function runtimeOf(id: string): LoopRuntime {
  return runtimes[id] ?? EMPTY
}

function patch(id: string, next: (prev: LoopRuntime) => LoopRuntime): void {
  setRuntimes(id, (prev) => next(prev ?? EMPTY))
}

function unref(timer: ReturnType<typeof setInterval>): void {
  const t = timer as unknown as { unref?: () => void }
  t.unref?.()
}

/** Per-loop cosmetic ticker. Does NOT call any run-creating endpoint. */
const tickers = new Map<string, ReturnType<typeof setInterval>>()

/** Local ticker interval. Cosmetic only; server is the source of truth. */
const TICKER_INTERVAL_MS = 1_500

/** Best-effort per-file snapshot of a session's cumulative diff. */
function diffSnapshot(api: TuiPluginApi, sessionID: string): Store.DiffSnapshot {
  const snapshot: Store.DiffSnapshot = {}
  try {
    for (const file of api.state.session.diff(sessionID)) {
      snapshot[file.file] = {
        additions: file.additions,
        deletions: file.deletions,
      }
    }
  } catch {
    // diff state unavailable — treat as empty
  }
  return snapshot
}

/** Let the reactive diff state settle after a run before snapshotting it. */
const DIFF_SETTLE_MS = 400
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, DIFF_SETTLE_MS))

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null) {
    const msg = (error as { message?: unknown }).message
    if (typeof msg === "string") return msg
  }
  return String(error)
}

/**
 * Trigger an autonomous run via the server's loop engine. Returns immediately;
 * progress is observed via bus events and reflected in the reactive store.
 */
export async function runOnce(api: TuiPluginApi, def: LoopDefinition, opts?: { manual?: boolean }): Promise<void> {
  const api2 = new LoopApi(api.client)
  const current = runtimeOf(def.id)
  if (current.status === "running") return
  if (current.status === "paused" && !opts?.manual) return
  patch(def.id, (prev) => ({
    ...prev,
    status: "running",
    lastError: undefined,
  }))
  const ok = await api2.run(def.id).catch(() => false)
  if (!ok) {
    patch(def.id, (prev) => ({
      ...prev,
      status: "error",
      lastError: "Failed to start the run on the server",
    }))
  }
}

/** Reconcile the local reactive store with the server's view. Skips tombstones. */
export async function syncWithServer(api: TuiPluginApi): Promise<void> {
  const api2 = new LoopApi(api.client)
  try {
    const { runtimes, loops } = await api2.list()
    // Drop tombstones that no longer exist on the server.
    const ids = new Set(loops.map((d) => d.id))
    for (const id of Array.from(tombstones)) if (!ids.has(id)) tombstones.delete(id)
    for (const { loopID, runtime } of runtimes) {
      if (tombstones.has(loopID)) continue
      setRuntimes(loopID, runtime)
    }
  } catch {
    // Server unreachable — keep the local cache
  }
}

/** Subscribe to bus events. Returns the unsubscribe function. */
export function subscribeEvents(api: TuiPluginApi): () => void {
  return subscribeLoopEvents(api.event, {
    onRunStarted: (loopID, _runID, sessionID) => {
      if (sessionID) sessionByLoop.set(loopID, sessionID)
      patch(loopID, (prev) => ({
        ...prev,
        status: "running",
        lastError: undefined,
        ...(sessionID ? { sessionID } : {}),
      }))
    },
    onRunFinished: async (loopID, _runID, status, ok, error) => {
      // Capture diff after settle so the run's contribution shows in the
      // history. The server's `sessionID` is the most reliable source.
      const sessionID = sessionByLoop.get(loopID) ?? runtimeOf(loopID).sessionID
      let additions = 0
      let deletions = 0
      let files = 0
      if (sessionID) {
        await settle()
        try {
          const after = diffSnapshot(api, sessionID)
          // We don't have a pre-run baseline here, so we report the post-run
          // cumulative diff. The store's `loopStats` uses additions/deletions
          // as totals; for the run detail we display the post-run session diff
          // as a proxy. The history view is best-effort and consistent.
          for (const f of Object.values(after)) {
            additions += f.additions
            deletions += f.deletions
            if (f.additions > 0 || f.deletions > 0) files += 1
          }
        } catch {
          // ignore
        }
      }
      const nextStatus: LoopRuntimeStatus = ok ? "idle" : "error"
      patch(loopID, (prev) => ({
        ...prev,
        status: nextStatus,
        lastError: ok ? undefined : error,
        runs: ok ? prev.runs + 1 : prev.runs,
        lastRunAt: Date.now(),
      }))
      // Record locally for the history view.
      Store.recordRun(api.kv, loopID, {
        startedAt: Date.now() - DIFF_SETTLE_MS,
        endedAt: Date.now(),
        ok,
        ...(error ? { error } : {}),
        ...(sessionID ? { sessionID } : {}),
        additions,
        deletions,
        files,
      })
      void status
    },
    onUpserted: (loopID) => {
      // Tombstone check: if the server says a loop was re-upserted that we
      // recently saw removed, ignore until the next sync.
      if (tombstones.has(loopID)) {
        void loopID
        return
      }
      void syncWithServer(api)
    },
    onRemoved: (loopID) => {
      // Drop reactive state AND the local KV cache for the removed loop.
      tombstones.add(loopID)
      setRuntimes(loopID, EMPTY)
      Store.removeById(api.kv, loopID)
      Store.clearHistory(api.kv, loopID)
      sessionByLoop.delete(loopID)
    },
    onRuntimeChanged: (loopID) => {
      // Engine published a state change; pull fresh runtimes.
      void syncWithServer(api)
      void loopID
    },
  })
}

/**
 * Subscribe a cosmetic ticker for a loop. The ticker only refreshes the
 * reactive store from the server's `LoopApi.getRuntime(id)` — it never
 * writes run records and never calls `loop.run`. The server's
 * `Scheduler.register` is the only place that fires runs.
 */
export function subscribeTicker(api: TuiPluginApi, def: LoopDefinition): void {
  unsubscribeTicker(def.id)
  if (!def.enabled || def.trigger.kind !== "interval") return
  const api2 = new LoopApi(api.client)
  const timer = setInterval(() => {
    void api2
      .getRuntime(def.id)
      .then((runtime) => {
        if (runtime && !tombstones.has(def.id)) {
          setRuntimes(def.id, runtime)
        }
      })
      .catch(() => {})
  }, TICKER_INTERVAL_MS)
  unref(timer)
  tickers.set(def.id, timer)
}

export function unsubscribeTicker(id: string): void {
  const timer = tickers.get(id)
  if (timer) clearInterval(timer)
  tickers.delete(id)
}

/** Reconcile tickers + reactive state with the server's view. */
export async function syncAll(api: TuiPluginApi): Promise<void> {
  const api2 = new LoopApi(api.client)
  try {
    const { loops } = await api2.list()
    const ids = new Set(loops.map((d) => d.id))
    for (const id of Array.from(tickers.keys())) if (!ids.has(id)) unsubscribeTicker(id)
    for (const def of loops) subscribeTicker(api, def)
    await syncWithServer(api)
  } catch {
    // Server unreachable — fall back to whatever the local KV knows.
    const defs = Store.loadAll(api.kv)
    for (const def of defs) subscribeTicker(api, def)
  }
}

export async function persist(api: TuiPluginApi, def: LoopDefinition): Promise<LoopDefinition> {
  const api2 = new LoopApi(api.client)
  // If the loop already exists on the server, route to update; otherwise upsert.
  // (We can't tell from a fresh `def` whether it's brand new, so we attempt
  // get first to disambiguate.)
  const existing = await api2.get(def.id).catch(() => undefined)
  const saved = existing ? await api2.update(def) : await api2.upsert(def)
  tombstones.delete(saved.id)
  // Keep the local KV cache in sync so the manager renders the latest state
  // even if the bus event hasn't fired yet.
  Store.upsert(api.kv, saved)
  return saved
}

export async function removeDefinition(api: TuiPluginApi, id: string): Promise<boolean> {
  const api2 = new LoopApi(api.client)
  const ok = await api2.remove(id)
  if (ok) {
    tombstones.add(id)
    Store.removeById(api.kv, id)
    Store.clearHistory(api.kv, id)
    setRuntimes(id, EMPTY)
    sessionByLoop.delete(id)
  }
  return ok
}

export async function setDefinitionEnabled(
  api: TuiPluginApi,
  id: string,
  enabled: boolean,
): Promise<LoopDefinition | undefined> {
  const api2 = new LoopApi(api.client)
  const next = await api2.setEnabled(id, enabled)
  if (next) Store.upsert(api.kv, next)
  return next
}

export async function pause(api: TuiPluginApi, def: LoopDefinition): Promise<void> {
  const api2 = new LoopApi(api.client)
  patch(def.id, (prev) => ({ ...prev, status: "paused" }))
  const ok = await api2.pause(def.id).catch(() => false)
  if (!ok)
    patch(def.id, (prev) => ({
      ...prev,
      status: "error",
      lastError: "Failed to pause",
    }))
}

export async function resume(api: TuiPluginApi, def: LoopDefinition): Promise<void> {
  const api2 = new LoopApi(api.client)
  patch(def.id, (prev) => ({ ...prev, status: "idle" }))
  const ok = await api2.resume(def.id).catch(() => false)
  if (!ok)
    patch(def.id, (prev) => ({
      ...prev,
      status: "error",
      lastError: "Failed to resume",
    }))
}

export async function abortRun(api: TuiPluginApi, id: string): Promise<void> {
  // Best-effort: ask the server to cancel any in-flight run for this loop.
  // If the server doesn't expose a per-loop abort endpoint, this is a no-op
  // on the server side and we just clear local cached state.
  const api2 = new LoopApi(api.client)
  await api2.abort(id).catch(() => {})
  sessionByLoop.delete(id)
  patch(id, (prev) => ({ ...prev, status: "idle", sessionID: undefined }))
}

/** Stop a loop's ticker and clear its local state. */
export async function stop(api: TuiPluginApi, id: string): Promise<void> {
  unsubscribeTicker(id)
  sessionByLoop.delete(id)
  patch(id, (prev) => ({ ...prev, status: "idle", sessionID: undefined }))
}

/** Tear down every ticker (plugin disposal). */
export function disposeAll(): void {
  for (const timer of tickers.values()) clearInterval(timer)
  tickers.clear()
}

export type LoopTone = "muted" | "running" | "error" | "ok"

/** Pure status summary for rendering (no JSX/theme coupling). */
export function statusInfo(def: LoopDefinition, rt: LoopRuntime): { label: string; tone: LoopTone } {
  if (rt.status === "running") return { label: "running", tone: "running" }
  if (rt.status === "cancelling") return { label: "cancelling", tone: "running" }
  if (rt.status === "error")
    return {
      label: rt.lastError ? `error: ${truncate(rt.lastError, 24)}` : "error",
      tone: "error",
    }
  if (rt.status === "paused") return { label: "paused", tone: "muted" }
  if (!def.enabled) return { label: "disabled", tone: "muted" }
  if (def.trigger.kind === "interval")
    return {
      label: `every ${Store.formatDuration(def.trigger.everyMs)}`,
      tone: "ok",
    }
  return { label: "manual", tone: "muted" }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}
