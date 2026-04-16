import fs from "fs/promises"
import path from "path"
import { adjectives, animals, colors, uniqueNamesGenerator } from "unique-names-generator"
import z from "zod"
import { Global } from "@/global"
import { Instance } from "@/project/instance"
import { SandboxRegistry } from "@/sandbox/registry"
import { Sandbox } from "@/sandbox/types"
import { Session } from "@/session"
import { MessageV2 } from "@/session/message-v2"
import { Storage } from "@/storage/storage"
import { Log } from "@/util/log"

export namespace BackgroundRun {
  const log = Log.create({ service: "background.run" })
  const OWNER_ID = `${process.pid}-${Date.now()}`
  export const LEASE_TIMEOUT_MS = 15_000

  export const Status = z.enum(["running", "complete", "error", "timeout", "cancelled", "orphaned"])
  export type Status = z.infer<typeof Status>
  export const Source = z.enum(["task", "model-subtask", "advisor", "delegator", "other"])
  export type Source = z.infer<typeof Source>

  export const Record = z.object({
    id: z.string(),
    sessionID: z.string().optional(),
    parentSessionID: z.string(),
    agent: z.string(),
    prompt: z.string(),
    status: Status,
    createdAt: z.number(),
    updatedAt: z.number(),
    completedAt: z.number().optional(),
    artifactPath: z.string(),
    title: z.string(),
    workspaceID: z.string().optional(),
    sandboxRef: Sandbox.Ref.optional(),
    sandboxState: Sandbox.State.optional(),
    source: Source.optional(),
    resultSummary: z.string().optional(),
    progressSummary: z.string().optional(),
    error: z.string().optional(),
    ownerID: z.string().optional(),
    ownerPID: z.number().int().positive().optional(),
    heartbeatAt: z.number().optional(),
    lastActivityAt: z.number().optional(),
    // Delegator fields
    delegatorID: z.string().optional(),
    delegatorSessionID: z.string().optional(),
    delegatorEnabled: z.boolean().optional(),
  })
  export type Record = z.infer<typeof Record>

  function generateID(): string {
    return uniqueNamesGenerator({
      dictionaries: [adjectives, colors, animals],
      separator: "-",
      length: 3,
      style: "lowerCase",
    })
  }

  function key(id: string) {
    return ["background_run", Instance.project.id, id]
  }

  function directory(parentSessionID: string) {
    return path.join(Global.Path.data, "delegations", parentSessionID)
  }

  function artifactPath(parentSessionID: string, id: string) {
    return path.join(directory(parentSessionID), `${id}.md`)
  }

  function statusGlyph(status: Status) {
    if (status === "complete") return "✓"
    if (status === "error") return "✗"
    if (status === "timeout") return "⏰"
    if (status === "orphaned") return "!"
    return "-"
  }

  async function ensureArtifactDirectory(parentSessionID: string) {
    const dir = directory(parentSessionID)
    await fs.mkdir(dir, { recursive: true })
    return dir
  }

  function renderArtifact(record: Record, result = record.resultSummary ?? "", error = record.error) {
    return `# ${statusGlyph(record.status)} ${record.title}

${record.prompt.slice(0, 200)}

**ID:** ${record.id}
**Agent:** ${record.agent}
**Status:** ${record.status}
**Source:** ${record.source ?? "other"}
**Session:** ${record.sessionID ?? "N/A"}
**Started:** ${new Date(record.createdAt).toISOString()}
**Completed:** ${record.completedAt ? new Date(record.completedAt).toISOString() : "N/A"}
**Last Activity:** ${record.lastActivityAt ? new Date(record.lastActivityAt).toISOString() : "N/A"}
${record.progressSummary ? `**Progress:** ${record.progressSummary}` : ""}
${error ? `**Error:** ${error}` : ""}

---

${result}
`
  }

  async function persistArtifact(record: Record, result: string, error?: string) {
    await ensureArtifactDirectory(record.parentSessionID)
    const content = renderArtifact(record, result, error)

    await fs.writeFile(record.artifactPath, content, "utf8")
  }

  export async function create(params: {
    parentSessionID: string
    agent: string
    prompt: string
    title?: string
    session?: Pick<Session.Info, "id" | "directory" | "workspaceID">
    source?: Source
    delegatorID?: string
    delegatorSessionID?: string
    delegatorEnabled?: boolean
  }): Promise<Record> {
    const id = generateID()
    const record: Record = {
      id,
      sessionID: params.session?.id,
      parentSessionID: params.parentSessionID,
      agent: params.agent,
      prompt: params.prompt,
      status: "running",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      artifactPath: artifactPath(params.parentSessionID, id),
      title: (params.title ?? params.prompt).slice(0, 50).replace(/\n/g, " "),
      workspaceID: params.session?.workspaceID,
      source: params.source,
      ownerID: OWNER_ID,
      ownerPID: process.pid,
      heartbeatAt: Date.now(),
      lastActivityAt: Date.now(),
      delegatorID: params.delegatorID,
      delegatorSessionID: params.delegatorSessionID,
      delegatorEnabled: params.delegatorEnabled,
    }

    if (params.session) {
      const sandbox = await SandboxRegistry.fromSession(params.session)
      record.sandboxRef = sandbox.ref
      record.sandboxState = sandbox.state
    }

    await Storage.write(key(id), record)
    return record
  }

  export async function updateSession(id: string, session: Pick<Session.Info, "id" | "directory" | "workspaceID">) {
    const sandbox = await SandboxRegistry.fromSession(session)
    return Storage.update<Record>(key(id), (draft) => {
      draft.sessionID = session.id
      draft.workspaceID = session.workspaceID
      draft.sandboxRef = sandbox.ref
      draft.sandboxState = sandbox.state
      draft.updatedAt = Date.now()
      draft.ownerID = OWNER_ID
      draft.ownerPID = process.pid
      draft.heartbeatAt = Date.now()
      draft.lastActivityAt = Date.now()
    })
  }

  export async function touchLease(id: string) {
    return Storage.update<Record>(key(id), (draft) => {
      if (draft.status !== "running") return
      draft.ownerID = OWNER_ID
      draft.ownerPID = process.pid
      draft.heartbeatAt = Date.now()
      draft.updatedAt = Date.now()
    })
  }

  export async function updateProgress(id: string, progressSummary?: string) {
    return Storage.update<Record>(key(id), (draft) => {
      if (draft.status !== "running") return
      draft.progressSummary = progressSummary || undefined
      draft.lastActivityAt = Date.now()
      draft.updatedAt = Date.now()
      draft.ownerID = OWNER_ID
      draft.ownerPID = process.pid
      draft.heartbeatAt = Date.now()
    })
  }

  export async function setDelegatorID(id: string, delegatorID: string) {
    return Storage.update<Record>(key(id), (draft) => {
      draft.delegatorID = delegatorID
      draft.updatedAt = Date.now()
    })
  }

  export async function get(id: string) {
    return Storage.read<Record>(key(id))
  }

  async function listAll(): Promise<Record[]> {
    const result: Record[] = []
    for (const item of await Storage.list(["background_run", Instance.project.id])) {
      try {
        const record = await Storage.read<Record>(item)
        result.push(record)
      } catch {
        continue
      }
    }
    return result.sort((a, b) => a.id.localeCompare(b.id))
  }

  export async function listForParent(parentSessionID: string): Promise<Record[]> {
    return (await listAll()).filter((r) => r.parentSessionID === parentSessionID)
  }

  export async function listForRelatedSession(sessionID: string): Promise<Record[]> {
    return (await listAll()).filter(
      (r) => r.parentSessionID === sessionID || r.sessionID === sessionID || r.delegatorSessionID === sessionID,
    )
  }

  export async function listRunning(): Promise<Record[]> {
    return (await listAll()).filter((r) => r.status === "running")
  }

  export async function countRunningForParent(parentSessionID: string) {
    return (await listAll()).filter((r) => r.parentSessionID === parentSessionID && r.status === "running").length
  }

  export async function summarizeSession(sessionID: string, result?: MessageV2.WithParts) {
    const messages = await Session.messages({ sessionID })
    const assistant =
      result?.info.role === "assistant" ? result : messages.findLast((item) => item.info.role === "assistant")
    const text = assistant?.parts.findLast((part): part is MessageV2.TextPart => part.type === "text")?.text ?? ""

    return {
      text,
      assistant: assistant?.info.role === "assistant" ? assistant.info : undefined,
    }
  }

  export async function finalize(id: string, status: Status, result: string, error?: string) {
    let finalized = false
    const record = await Storage.update<Record>(key(id), (draft) => {
      if (draft.status !== "running") return
      draft.status = status
      draft.updatedAt = Date.now()
      draft.completedAt = Date.now()
      draft.resultSummary = result || undefined
      draft.progressSummary = undefined
      draft.error = error
      draft.heartbeatAt = Date.now()
      draft.lastActivityAt = Date.now()
      finalized = true
    })
    if (!finalized) return undefined
    await persistArtifact(record, result, error)
    return record
  }

  export async function finalizeFromSession(id: string) {
    const record = await get(id).catch(() => undefined)
    if (!record?.sessionID) return false

    const summary = await summarizeSession(record.sessionID)
    const error = summary.assistant?.error
    if (error) {
      const status: Status = MessageV2.AbortedError.isInstance(error) ? "cancelled" : "error"
      const message = "message" in error && typeof error.message === "string" ? error.message : undefined
      await finalize(id, status, summary.text, message)
      return true
    }

    const finish = summary.assistant?.finish
    if (!finish || ["tool-calls", "unknown"].includes(finish)) {
      return false
    }

    await finalize(id, "complete", summary.text)
    return true
  }

  export async function markOrphaned(id: string, reason = "Nikcli restarted before the background task completed.") {
    const record = await get(id)
    if (!leaseExpired(record)) return false
    let text = record.resultSummary ?? ""
    if (record.sessionID) {
      const summary = await summarizeSession(record.sessionID).catch(() => undefined)
      text = summary?.text ?? text
    }
    const finalized = await finalize(id, "orphaned", text, reason)
    return Boolean(finalized)
  }

  export function leaseExpired(record: Pick<Record, "status" | "heartbeatAt" | "ownerID">, now = Date.now()) {
    if (record.status !== "running") return false
    if (!record.ownerID || !record.heartbeatAt) return true
    return now - record.heartbeatAt > LEASE_TIMEOUT_MS
  }

  export async function reconcileInterrupted(ignore = new Set<string>()) {
    const running = await listRunning()
    for (const record of running) {
      if (ignore.has(record.id)) continue
      if (!leaseExpired(record)) continue
      const finalized = await finalizeFromSession(record.id).catch((error) => {
        log.warn("failed to reconcile background run", {
          id: record.id,
          error,
        })
        return false
      })
      if (finalized) continue
      await markOrphaned(record.id)
    }
  }

  export async function readArtifact(id: string): Promise<string> {
    const record = await get(id).catch(() => undefined)
    if (!record) {
      throw new Error(`Delegation \"${id}\" not found.`)
    }

    try {
      return await fs.readFile(record.artifactPath, "utf8")
    } catch {
      return renderArtifact(record, record.resultSummary ?? record.progressSummary ?? "", record.error)
    }
  }

  export function outputPreview(record: Pick<Record, "status" | "progressSummary" | "resultSummary">) {
    if (record.status === "running") return record.progressSummary
    return record.resultSummary ?? record.progressSummary
  }
}
