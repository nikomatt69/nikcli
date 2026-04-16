import fs from "fs/promises"
import path from "path"
import z from "zod"
import { BackgroundRun } from "@/background/run"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Global } from "@/global"
import { Monitor } from "@/monitor/manager"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { Log } from "@/util/log"

const DelegationCompletedEvent = BusEvent.define(
  "delegation.completed",
  z.object({
    delegationID: z.string(),
    parentSessionID: z.string(),
    status: z.enum(["running", "complete", "error", "timeout", "cancelled", "orphaned"]),
    title: z.string(),
  }),
)

export namespace Delegation {
  const log = Log.create({ service: "delegation" })

  export const Status = z.enum(["running", "complete", "error", "timeout", "cancelled", "orphaned"])
  export type Status = z.infer<typeof Status>
  export type Record = BackgroundRun.Record

  export interface ListItem {
    id: string
    status: Status
    title: string
    agent: string
    description?: string
  }

  export interface InspectResult {
    id: string
    status: Status
    title: string
    agent: string
    source?: BackgroundRun.Source
    prompt: string
    parentSessionID: string
    sessionID?: string
    delegatorID?: string
    delegatorSessionID?: string
    createdAt: number
    updatedAt: number
    completedAt?: number
    lastActivityAt?: number
    progressSummary?: string
    resultSummary?: string
    error?: string
  }

  const activeDelegations = new Map<string, Record>()
  const sessionToDelegation = new Map<string, string>()
  const timers = new Map<string, NodeJS.Timeout>()
  const heartbeats = new Map<string, NodeJS.Timeout>()
  let reconcileTimer: NodeJS.Timeout | undefined
  const requestedFinalizations = new Map<string, { status: Exclude<Status, "running" | "orphaned">; error?: string }>()
  const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000

  function getDelegationsDir(parentSessionID: string): string {
    return path.join(Global.Path.data, "delegations", parentSessionID)
  }

  async function ensureDelegationsDir(parentSessionID: string): Promise<string> {
    const dir = getDelegationsDir(parentSessionID)
    await fs.mkdir(dir, { recursive: true })
    return dir
  }

  function toInspectResult(record: Record): InspectResult {
    return {
      id: record.id,
      status: record.status,
      title: record.title,
      agent: record.agent,
      source: record.source,
      prompt: record.prompt,
      parentSessionID: record.parentSessionID,
      sessionID: record.sessionID,
      delegatorID: record.delegatorID,
      delegatorSessionID: record.delegatorSessionID,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      completedAt: record.completedAt,
      lastActivityAt: record.lastActivityAt,
      progressSummary: record.progressSummary,
      resultSummary: record.resultSummary,
      error: record.error,
    }
  }

  function hasAccess(record: Pick<Record, "parentSessionID" | "sessionID" | "delegatorSessionID">, sessionID: string) {
    return (
      record.parentSessionID === sessionID || record.sessionID === sessionID || record.delegatorSessionID === sessionID
    )
  }

  function cleanup(record: Pick<Record, "id" | "sessionID">): void {
    clearTimer(record.id)
    clearHeartbeat(record.id)
    requestedFinalizations.delete(record.id)
    activeDelegations.delete(record.id)
    if (record.sessionID && sessionToDelegation.get(record.sessionID) === record.id) {
      sessionToDelegation.delete(record.sessionID)
    }
  }

  function clearTimer(delegationID: string): void {
    const timer = timers.get(delegationID)
    if (!timer) return
    clearTimeout(timer)
    timers.delete(delegationID)
  }

  function clearHeartbeat(delegationID: string): void {
    const timer = heartbeats.get(delegationID)
    if (!timer) return
    clearInterval(timer)
    heartbeats.delete(delegationID)
  }

  function setHeartbeat(delegationID: string): void {
    clearHeartbeat(delegationID)
    const timer = setInterval(
      () => {
        void BackgroundRun.touchLease(delegationID).catch((error) => {
          log.warn("Failed to refresh delegation lease", {
            delegationID,
            error,
          })
        })
      },
      Math.max(1000, Math.floor(BackgroundRun.LEASE_TIMEOUT_MS / 3)),
    )
    heartbeats.set(delegationID, timer)
  }

  function requestFinalization(
    delegationID: string,
    status: Exclude<Status, "running" | "orphaned">,
    error?: string,
  ): void {
    if (!activeDelegations.has(delegationID)) return
    requestedFinalizations.set(delegationID, { status, error })
  }

  function scheduleForcedFinalize(
    delegationID: string,
    status: Exclude<Status, "running" | "orphaned">,
    error?: string,
    delayMs: number = 1000,
  ): void {
    clearTimer(delegationID)
    const timer = setTimeout(() => {
      void finalize(delegationID, status, "", error).catch((err) => {
        log.error(`Failed to force finalize delegation ${delegationID}: ${err}`)
      })
    }, delayMs)
    timers.set(delegationID, timer)
  }

  function setTimer(delegationID: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): void {
    clearTimer(delegationID)
    const timer = setTimeout(async () => {
      try {
        const record = activeDelegations.get(delegationID)
        requestFinalization(delegationID, "timeout", "Timed out")
        if (record?.sessionID) {
          SessionPrompt.cancel(record.sessionID)
        }
        scheduleForcedFinalize(delegationID, "timeout", "Timed out")
      } catch (err) {
        log.error(`Failed to finalize delegation ${delegationID} on timeout: ${err}`)
      }
    }, timeoutMs)
    timers.set(delegationID, timer)
  }

  export async function init() {
    await BackgroundRun.reconcileInterrupted(new Set(activeDelegations.keys()))
    if (reconcileTimer) return
    reconcileTimer = setInterval(() => {
      void BackgroundRun.reconcileInterrupted(new Set(activeDelegations.keys())).catch((error) => {
        log.warn("Failed to reconcile background runs", {
          error,
        })
      })
    }, BackgroundRun.LEASE_TIMEOUT_MS)
  }

  export async function create(params: {
    parentSessionID: string
    agent: string
    prompt: string
    session?: Pick<Session.Info, "id" | "directory" | "workspaceID">
    source?: BackgroundRun.Source
    delegatorID?: string
    delegatorSessionID?: string
    delegatorEnabled?: boolean
  }): Promise<Record> {
    await ensureDelegationsDir(params.parentSessionID)

    const record = await BackgroundRun.create({
      parentSessionID: params.parentSessionID,
      agent: params.agent,
      prompt: params.prompt,
      session: params.session,
      source: params.source,
      delegatorID: params.delegatorID,
      delegatorSessionID: params.delegatorSessionID,
      delegatorEnabled: params.delegatorEnabled,
    })

    activeDelegations.set(record.id, record)
    setTimer(record.id)
    setHeartbeat(record.id)

    log.info(`Created delegation ${record.id} for agent ${params.agent}`)
    return record
  }

  export function setSessionID(delegationID: string, sessionID: string): void {
    const record = activeDelegations.get(delegationID)
    if (record) {
      record.sessionID = sessionID
      sessionToDelegation.set(sessionID, delegationID)
    }

    void Session.get(sessionID)
      .then((session) => BackgroundRun.updateSession(delegationID, session))
      .catch(() => {
        log.warn("Failed to attach session to background run", {
          delegationID,
          sessionID,
        })
      })
  }

  /**
   * Returns a delegation record from the in-memory active map only.
   * Use {@link inspect} / {@link getDurable} for cross-process / durable lookups.
   */
  export function getActive(id: string): Record | undefined {
    return activeDelegations.get(id)
  }

  /**
   * Returns a delegation record from durable storage, falling back to the
   * in-memory active map so callers get a consistent view across processes.
   */
  export async function getDurable(id: string): Promise<Record | undefined> {
    const persisted = await BackgroundRun.get(id).catch(() => undefined)
    if (persisted) return persisted
    return activeDelegations.get(id)
  }

  export function getBySessionID(sessionID: string): Record | undefined {
    const delegationID = sessionToDelegation.get(sessionID)
    if (!delegationID) return undefined
    return activeDelegations.get(delegationID)
  }

  export async function finalize(delegationID: string, status: Status, result: string, error?: string): Promise<void> {
    const active = activeDelegations.get(delegationID)
    const persisted = await BackgroundRun.get(delegationID).catch(() => undefined)
    if (!persisted || persisted.status !== "running") return

    const requested = requestedFinalizations.get(delegationID)
    const finalStatus = requested?.status ?? status
    const finalError = requested?.error ?? error
    let finalized: Awaited<ReturnType<typeof BackgroundRun.finalize>>
    try {
      finalized = await BackgroundRun.finalize(delegationID, finalStatus, result, finalError)
      if (!finalized) return

      await Bus.publish(DelegationCompletedEvent, {
        delegationID: finalized.id,
        parentSessionID: finalized.parentSessionID,
        status: finalStatus,
        title: finalized.prompt.slice(0, 50),
      })

      log.info(`Finalized delegation ${delegationID} with status ${finalStatus}`)
    } finally {
      cleanup(active ?? { id: delegationID, sessionID: persisted.sessionID })
    }
  }

  export async function updateProgress(delegationID: string, progressSummary?: string): Promise<void> {
    const active = activeDelegations.get(delegationID)
    if (active) active.progressSummary = progressSummary
    await BackgroundRun.updateProgress(delegationID, progressSummary)
  }

  /**
   * Attach the supervising delegator record's ID to a subagent delegation so
   * UIs and `inspect()` consumers can jump from a task record to its
   * synthesizing delegator without scanning every delegation.
   */
  export async function linkDelegator(delegationID: string, delegatorID: string): Promise<void> {
    const active = activeDelegations.get(delegationID)
    if (active) active.delegatorID = delegatorID
    await BackgroundRun.setDelegatorID(delegationID, delegatorID)
  }

  export async function inspect(delegationID: string): Promise<InspectResult | undefined> {
    const record = await BackgroundRun.get(delegationID).catch(() => undefined)
    if (!record) return undefined
    return toInspectResult(record)
  }

  export async function inspectForSession(sessionID: string, delegationID: string): Promise<InspectResult | undefined> {
    const record = await BackgroundRun.get(delegationID).catch(() => undefined)
    if (!record || !hasAccess(record, sessionID)) return undefined
    return toInspectResult(record)
  }

  export async function read(delegationID: string): Promise<string> {
    return BackgroundRun.readArtifact(delegationID)
  }

  export async function readForSession(sessionID: string, delegationID: string): Promise<string | undefined> {
    const record = await BackgroundRun.get(delegationID).catch(() => undefined)
    if (!record || !hasAccess(record, sessionID)) return undefined
    return BackgroundRun.readArtifact(delegationID)
  }

  export async function list(parentSessionID: string): Promise<ListItem[]> {
    return (await BackgroundRun.listForParent(parentSessionID)).map((record) => ({
      id: record.id,
      status: record.status,
      title: record.title,
      agent: record.agent,
      description: record.status === "running" ? "(running)" : undefined,
    }))
  }

  export async function getRunningCount(parentSessionID: string): Promise<number> {
    return BackgroundRun.countRunningForParent(parentSessionID)
  }

  export async function cancel(delegationID: string): Promise<boolean> {
    const active = activeDelegations.get(delegationID)
    const persisted = await BackgroundRun.get(delegationID).catch(() => undefined)
    if (!persisted || persisted.status !== "running") return false

    requestFinalization(delegationID, "cancelled", "Cancelled")
    if (persisted.sessionID) {
      SessionPrompt.cancel(persisted.sessionID)
      await Monitor.cancelAll(persisted.sessionID)
    }

    if (active) {
      scheduleForcedFinalize(delegationID, "cancelled", "Cancelled")
      return true
    }

    await finalize(delegationID, "cancelled", persisted.resultSummary ?? "", "Cancelled")
    return true
  }

  export async function cancelForSession(sessionID: string, delegationID: string): Promise<boolean> {
    const record = await BackgroundRun.get(delegationID).catch(() => undefined)
    if (!record || !hasAccess(record, sessionID)) return false
    return cancel(delegationID)
  }

  /**
   * Cancels every running delegation related to the given session (as parent,
   * worker, or delegator). Intended for explicit "cancel everything" flows.
   * HTTP handlers scoping to a single delegation should use {@link cancelOwnedBySessionID}.
   */
  export async function cancelBySessionID(sessionID: string): Promise<boolean> {
    const related = await BackgroundRun.listForRelatedSession(sessionID)
    const running = related.filter((item) => item.status === "running")
    if (running.length === 0) return false
    const result = await Promise.all(running.map((item) => cancel(item.id)))
    return result.some(Boolean)
  }

  /**
   * Cancels the single delegation that owns the given worker session, if any.
   * O(1) via the in-memory worker-session→delegation index; falls back to the
   * durable store when the delegation was created by another process.
   */
  export async function cancelOwnedBySessionID(sessionID: string): Promise<boolean> {
    const active = getBySessionID(sessionID)
    if (active) return cancel(active.id)
    const related = await BackgroundRun.listForRelatedSession(sessionID)
    const owned = related.find((item) => item.sessionID === sessionID && item.status === "running")
    if (!owned) return false
    return cancel(owned.id)
  }

  export function outputPreview(record: Pick<Record, "status" | "progressSummary" | "resultSummary">) {
    return BackgroundRun.outputPreview(record)
  }
}
