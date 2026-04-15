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
  }): Promise<Record> {
    await ensureDelegationsDir(params.parentSessionID)

    const record = await BackgroundRun.create({
      parentSessionID: params.parentSessionID,
      agent: params.agent,
      prompt: params.prompt,
      session: params.session,
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

  export function get(id: string): Record | undefined {
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

  export async function read(delegationID: string): Promise<string> {
    return BackgroundRun.readArtifact(delegationID)
  }

  export async function list(parentSessionID: string): Promise<ListItem[]> {
    const results: ListItem[] = (await BackgroundRun.listForParent(parentSessionID)).map((record) => ({
      id: record.id,
      status: record.status,
      title: record.title,
      agent: record.agent,
      description: record.status === "running" ? "(running)" : undefined,
    }))

    const dir = getDelegationsDir(parentSessionID)
    try {
      const files = await fs.readdir(dir)
      for (const file of files) {
        if (!file.endsWith(".md")) continue
        const id = file.replace(".md", "")
        if (results.find((item) => item.id === id)) continue

        try {
          const content = await fs.readFile(path.join(dir, file), "utf8")
          const titleMatch = content.match(/^# .+? (.+)$/m)
          const agentMatch = content.match(/\*\*Agent:\*\* (.+)$/m)
          const statusMatch = content.match(/\*\*Status:\*\* (.+)$/m)
          const rawStatus = statusMatch?.[1]?.trim()

          results.push({
            id,
            status: Status.catch("complete").parse(rawStatus),
            title: titleMatch?.[1]?.trim() || id,
            agent: agentMatch?.[1]?.trim() || "unknown",
          })
        } catch {
          continue
        }
      }
    } catch {
      // ignore
    }

    return results.sort((a, b) => a.id.localeCompare(b.id))
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
}
