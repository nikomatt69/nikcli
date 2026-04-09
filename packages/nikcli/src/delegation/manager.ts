import { Log } from "@/util/log"
import { Global } from "@/global"
import path from "path"
import fs from "fs/promises"
import { uniqueNamesGenerator, adjectives, animals, colors } from "unique-names-generator"
import z from "zod"
import { Instance } from "@/project/instance"
import { SessionPrompt } from "@/session/prompt"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"

const DelegationCompletedEvent = BusEvent.define(
  "delegation.completed",
  z.object({
    delegationID: z.string(),
    parentSessionID: z.string(),
    status: z.enum(["running", "complete", "error", "timeout", "cancelled"]),
    title: z.string(),
  }),
)

export namespace Delegation {
  const log = Log.create({ service: "delegation" })

  export const Status = z.enum(["running", "complete", "error", "timeout", "cancelled"])
  export type Status = z.infer<typeof Status>

  export const Record = z.object({
    id: z.string(),
    sessionID: z.string(),
    parentSessionID: z.string(),
    agent: z.string(),
    prompt: z.string(),
    status: Status,
    createdAt: z.number(),
    completedAt: z.number().optional(),
    artifactPath: z.string(),
  })
  export type Record = z.infer<typeof Record>

  export interface ListItem {
    id: string
    status: Status
    title: string
    agent: string
    description?: string
  }

  // In-memory store for active delegations
  const activeDelegations = new Map<string, Record>()
  const sessionToDelegation = new Map<string, string>() // sessionID -> delegationID
  const timers = new Map<string, NodeJS.Timeout>() // delegationID -> timeout timer
  const requestedFinalizations = new Map<string, { status: Exclude<Status, "running">; error?: string }>()
  const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes

  function cleanup(record: Record): void {
    clearTimer(record.id)
    requestedFinalizations.delete(record.id)
    activeDelegations.delete(record.id)
    if (record.sessionID && sessionToDelegation.get(record.sessionID) === record.id) {
      sessionToDelegation.delete(record.sessionID)
    }
  }

  function clearTimer(delegationID: string): void {
    const timer = timers.get(delegationID)
    if (timer) {
      clearTimeout(timer)
      timers.delete(delegationID)
    }
  }

  function requestFinalization(delegationID: string, status: Exclude<Status, "running">, error?: string): void {
    if (!activeDelegations.has(delegationID)) return
    requestedFinalizations.set(delegationID, { status, error })
  }

  function scheduleForcedFinalize(
    delegationID: string,
    status: Exclude<Status, "running">,
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

  // Generate readable ID like "elegant-blue-tiger"
  function generateId(): string {
    return uniqueNamesGenerator({
      dictionaries: [adjectives, colors, animals],
      separator: "-",
      length: 3,
      style: "lowerCase",
    })
  }

  // Get delegations directory for a parent session
  function getDelegationsDir(parentSessionID: string): string {
    return path.join(Global.Path.data, "delegations", parentSessionID)
  }

  // Ensure delegations directory exists
  async function ensureDelegationsDir(parentSessionID: string): Promise<string> {
    const dir = getDelegationsDir(parentSessionID)
    await fs.mkdir(dir, { recursive: true })
    return dir
  }

  // Create a new delegation
  export async function create(params: { parentSessionID: string; agent: string; prompt: string }): Promise<Record> {
    const dir = await ensureDelegationsDir(params.parentSessionID)
    const id = generateId()
    const artifactPath = path.join(dir, `${id}.md`)

    const record: Record = {
      id,
      sessionID: "", // Will be set when session is created
      parentSessionID: params.parentSessionID,
      agent: params.agent,
      prompt: params.prompt,
      status: "running",
      createdAt: Date.now(),
      artifactPath,
    }

    activeDelegations.set(id, record)
    setTimer(id)

    log.info(`Created delegation ${id} for agent ${params.agent}`)
    return record
  }

  // Set session ID for a delegation (called after session creation)
  export function setSessionID(delegationID: string, sessionID: string): void {
    const record = activeDelegations.get(delegationID)
    if (record) {
      record.sessionID = sessionID
      sessionToDelegation.set(sessionID, delegationID)
    }
  }

  // Get delegation by ID
  export function get(id: string): Record | undefined {
    return activeDelegations.get(id)
  }

  // Get delegation by session ID
  export function getBySessionID(sessionID: string): Record | undefined {
    const delegationID = sessionToDelegation.get(sessionID)
    if (!delegationID) return undefined
    return activeDelegations.get(delegationID)
  }

  // Finalize a delegation with result

  export async function finalize(delegationID: string, status: Status, result: string, error?: string): Promise<void> {
    const record = activeDelegations.get(delegationID)
    if (!record) return

    // Prevent double finalization
    if (record.status !== "running") {
      return
    }

    const requested = requestedFinalizations.get(delegationID)
    const finalStatus = requested?.status ?? status
    const finalError = requested?.error ?? error

    record.status = finalStatus
    record.completedAt = Date.now()

    // Persist result to disk
    await persistResult(record, result, finalError)

    // Emit event for TUI notification
    Bus.publish(DelegationCompletedEvent, {
      delegationID: record.id,
      parentSessionID: record.parentSessionID,
      status: finalStatus,
      title: record.prompt.slice(0, 50),
    })

    cleanup(record)

    log.info(`Finalized delegation ${delegationID} with status ${finalStatus}`)
  }
  // Persist result to markdown file
  async function persistResult(record: Record, result: string, error?: string): Promise<void> {
    try {
      const title = record.prompt.slice(0, 50).replace(/\n/g, " ")
      const statusEmoji = record.status === "complete" ? "✓" : record.status === "error" ? "✗" : "⏰"

      const content = `# ${statusEmoji} ${title}

${record.prompt.slice(0, 200)}

**ID:** ${record.id}
**Agent:** ${record.agent}
**Status:** ${record.status}
**Session:** ${record.sessionID}
**Started:** ${new Date(record.createdAt).toISOString()}
**Completed:** ${record.completedAt ? new Date(record.completedAt).toISOString() : "N/A"}
${error ? `**Error:** ${error}` : ""}

---

${result}
`

      await fs.writeFile(record.artifactPath, content, "utf8")
      log.debug(`Persisted delegation result to ${record.artifactPath}`)
    } catch (err) {
      log.error(`Failed to persist delegation result: ${err}`)
    }
  }

  // Read delegation result
  export async function read(delegationID: string): Promise<string> {
    const record = activeDelegations.get(delegationID)

    // Try to read from disk first
    if (record) {
      try {
        const content = await fs.readFile(record.artifactPath, "utf8")
        return content
      } catch {
        // File doesn't exist yet
      }
    }

    // Check if delegation exists but is still running
    if (record && record.status === "running") {
      return `Delegation "${delegationID}" is still running...\nAgent: ${record.agent}\nStarted: ${new Date(record.createdAt).toISOString()}`
    }

    // Try to find in filesystem (for persisted delegations from previous sessions)
    // Search all delegation directories
    const delegationsBase = path.join(Global.Path.data, "delegations")
    try {
      const dirs = await fs.readdir(delegationsBase)
      for (const dir of dirs) {
        const filePath = path.join(delegationsBase, dir, `${delegationID}.md`)
        try {
          const content = await fs.readFile(filePath, "utf8")
          return content
        } catch {
          // Continue searching
        }
      }
    } catch {
      // Base directory doesn't exist
    }

    throw new Error(`Delegation "${delegationID}" not found. Use delegation_list() to see available delegations.`)
  }

  // List delegations for a parent session
  export async function list(parentSessionID: string): Promise<ListItem[]> {
    const results: ListItem[] = []

    // Add in-memory delegations
    for (const record of activeDelegations.values()) {
      if (record.parentSessionID !== parentSessionID) continue
      results.push({
        id: record.id,
        status: record.status,
        title: record.prompt.slice(0, 50).replace(/\n/g, " "),
        agent: record.agent,
        description: record.status === "running" ? "(running)" : undefined,
      })
    }

    // Check filesystem for persisted delegations
    const dir = getDelegationsDir(parentSessionID)
    try {
      const files = await fs.readdir(dir)
      for (const file of files) {
        if (!file.endsWith(".md")) continue
        const id = file.replace(".md", "")

        // Deduplicate - prefer in-memory status
        if (results.find((r) => r.id === id)) continue

        // Read basic info from file
        try {
          const content = await fs.readFile(path.join(dir, file), "utf8")
          const titleMatch = content.match(/^# .+? (.+)$/m)
          const agentMatch = content.match(/\*\*Agent:\*\* (.+)$/m)
          const statusMatch = content.match(/\*\*Status:\*\* (.+)$/m)

          results.push({
            id,
            status: (statusMatch?.[1]?.trim() as Status) || "complete",
            title: titleMatch?.[1]?.trim() || id,
            agent: agentMatch?.[1]?.trim() || "unknown",
          })
        } catch {
          // Ignore read errors
        }
      }
    } catch {
      // Directory doesn't exist yet
    }

    return results.sort((a, b) => a.id.localeCompare(b.id))
  }

  // Get running delegations count for a parent session
  export function getRunningCount(parentSessionID: string): number {
    let count = 0
    for (const record of activeDelegations.values()) {
      if (record.parentSessionID === parentSessionID && record.status === "running") {
        count++
      }
    }
    return count
  }

  // Cancel a delegation
  export async function cancel(delegationID: string): Promise<boolean> {
    const record = activeDelegations.get(delegationID)
    if (!record) return false
    requestFinalization(delegationID, "cancelled", "Cancelled")
    if (record.sessionID) {
      SessionPrompt.cancel(record.sessionID)
    }
    scheduleForcedFinalize(delegationID, "cancelled", "Cancelled")
    return true
  }
}
