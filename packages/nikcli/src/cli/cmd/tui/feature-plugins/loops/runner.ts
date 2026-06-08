/**
 * Loops — runtime engine for the TUI.
 *
 * Owns the temporal triggers (interval timers) and drives each run through the
 * existing Goal system via `client.session.command({ command: "goal" })`. The
 * Goal system performs the autonomous until-done iteration server-side; this
 * engine only schedules, enforces back-pressure, and tracks live status.
 *
 * State is module-level so the manager dialog and the sidebar share one source
 * of truth. Reactivity is provided by a Solid store.
 */
import type { TuiPluginApi } from "@nikcli-ai/plugin/tui"
import { createStore } from "solid-js/store"
import * as Store from "./store"

export type LoopRuntimeStatus = "idle" | "running" | "paused" | "error"

export type LoopRuntime = {
  status: LoopRuntimeStatus
  runs: number
  lastRunAt?: number
  lastError?: string
  sessionID?: string
}

const EMPTY: LoopRuntime = { status: "idle", runs: 0 }

const [runtimes, setRuntimes] = createStore<Record<string, LoopRuntime>>({})
const timers = new Map<string, ReturnType<typeof setInterval>>()

export function runtimeOf(id: string): LoopRuntime {
  return runtimes[id] ?? EMPTY
}

function patch(id: string, next: (prev: LoopRuntime) => LoopRuntime): void {
  setRuntimes(id, (prev) => next(prev ?? EMPTY))
}

function runningCount(): number {
  return Object.values(runtimes).filter((r) => r?.status === "running").length
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null) {
    const msg = (error as { message?: unknown }).message
    if (typeof msg === "string") return msg
  }
  return String(error)
}

function unref(timer: ReturnType<typeof setInterval>): void {
  const t = timer as unknown as { unref?: () => void }
  t.unref?.()
}

/**
 * Run a single iteration of a loop: ensure a session exists, then kick the goal
 * command. Resolves once the autonomous goal run completes (or errors).
 */
export async function runOnce(api: TuiPluginApi, def: Store.LoopDefinition, opts?: { manual?: boolean }): Promise<void> {
  const current = runtimeOf(def.id)
  if (current.status === "running") return // single-flight per loop
  if (current.status === "paused" && !opts?.manual) return
  if (runningCount() >= Store.MAX_CONCURRENT_RUNS) return // global back-pressure

  patch(def.id, (prev) => ({ ...prev, status: "running", lastError: undefined }))

  try {
    let sessionID = runtimeOf(def.id).sessionID
    if (!sessionID) {
      const created = await api.client.session.create({ title: `loop: ${def.name}` })
      sessionID = created.data?.id
      if (!sessionID) throw new Error("could not create a session for this loop")
      patch(def.id, (prev) => ({ ...prev, sessionID }))
    }

    const args = def.tokenBudget ? `${def.objective} --token-budget ${def.tokenBudget}` : def.objective
    const result = await api.client.session.command({
      sessionID,
      command: "goal",
      arguments: args,
      agent: def.agent,
    })
    if (result.error) throw new Error(describeError(result.error))

    patch(def.id, (prev) => ({ ...prev, status: "idle", runs: prev.runs + 1, lastRunAt: Date.now() }))

    if (def.maxRuns !== undefined && runtimeOf(def.id).runs >= def.maxRuns) {
      disarm(def.id)
      api.ui.toast({ variant: "info", message: `Loop "${def.name}" reached its run cap (${def.maxRuns}).` })
    }
  } catch (error) {
    const message = describeError(error)
    patch(def.id, (prev) => ({ ...prev, status: "error", lastError: message }))
    api.ui.toast({ variant: "error", message: `Loop "${def.name}" failed: ${message}` })
  }
}

/** Arm (or re-arm) the interval timer for an enabled interval loop. No-op otherwise. */
export function arm(api: TuiPluginApi, def: Store.LoopDefinition): void {
  disarm(def.id)
  if (!def.enabled || def.trigger.kind !== "interval") return
  const timer = setInterval(() => {
    void runOnce(api, def)
  }, def.trigger.everyMs)
  unref(timer)
  timers.set(def.id, timer)
}

export function disarm(id: string): void {
  const timer = timers.get(id)
  if (timer) clearInterval(timer)
  timers.delete(id)
}

/** Reconcile live timers with the persisted definitions. Call after any CRUD change. */
export function syncAll(api: TuiPluginApi): void {
  const defs = Store.loadAll(api.kv)
  const ids = new Set(defs.map((d) => d.id))
  // Snapshot keys first — disarm() mutates the timers map.
  for (const id of Array.from(timers.keys())) if (!ids.has(id)) disarm(id)
  for (const def of defs) arm(api, def)
}

export async function pause(api: TuiPluginApi, def: Store.LoopDefinition): Promise<void> {
  disarm(def.id)
  patch(def.id, (prev) => ({ ...prev, status: "paused" }))
  const sessionID = runtimeOf(def.id).sessionID
  if (sessionID) {
    await api.client.session
      .command({ sessionID, command: "goal", arguments: "pause", agent: def.agent })
      .catch(() => {})
  }
}

export async function resume(api: TuiPluginApi, def: Store.LoopDefinition): Promise<void> {
  patch(def.id, (prev) => ({ ...prev, status: "idle" }))
  const sessionID = runtimeOf(def.id).sessionID
  if (sessionID) {
    await api.client.session
      .command({ sessionID, command: "goal", arguments: "resume", agent: def.agent })
      .catch(() => {})
  }
  arm(api, def)
}

/** Stop a loop's timer and abort its in-flight session run. */
export async function stop(api: TuiPluginApi, id: string): Promise<void> {
  disarm(id)
  const sessionID = runtimeOf(id).sessionID
  if (sessionID) await api.client.session.abort({ sessionID }).catch(() => {})
  patch(id, (prev) => ({ ...prev, status: "idle" }))
}

/** Tear down every timer (plugin disposal). */
export function disposeAll(): void {
  for (const timer of timers.values()) clearInterval(timer)
  timers.clear()
}

export type LoopTone = "muted" | "running" | "error" | "ok"

/** Pure status summary for rendering (no JSX/theme coupling). */
export function statusInfo(def: Store.LoopDefinition, rt: LoopRuntime): { label: string; tone: LoopTone } {
  if (rt.status === "running") return { label: "running", tone: "running" }
  if (rt.status === "error") return { label: "error", tone: "error" }
  if (rt.status === "paused") return { label: "paused", tone: "muted" }
  if (!def.enabled) return { label: "disabled", tone: "muted" }
  if (def.trigger.kind === "interval") return { label: `every ${Store.formatDuration(def.trigger.everyMs)}`, tone: "ok" }
  return { label: "manual", tone: "muted" }
}
