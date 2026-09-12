import type { MessageWithParts, Part, ToolPart, ToolState } from "@/lib/types"

/**
 * Background activity derived from the transcript.
 *
 * The host already publishes everything this view needs on the tool parts
 * themselves — the `task` tool carries the child session id, the delegation id
 * and a running summary of the sub-agent's own tool calls in its metadata — so
 * the sheet reads the session it already has instead of polling a second
 * endpoint.
 */

export type BackgroundTaskKind = "agent" | "shell"

export type BackgroundTaskStatus = "running" | "completed" | "error" | "stopped"

export type BackgroundTask = {
  /** Tool part id — stable across stream updates, so it keys the list. */
  id: string
  callID: string
  kind: BackgroundTaskKind
  title: string
  status: BackgroundTaskStatus
  /** Set for `task` runs: the sub-agent's own session, i.e. its transcript. */
  childSessionID?: string
  agentType?: string
  /** Shell command, kept for the card's second line. */
  command?: string
  startedAt?: number
  endedAt?: number
  /** Tool calls the sub-agent has made so far, from the task metadata summary. */
  toolUses?: number
  /** True when the run was explicitly detached by the model. */
  detached: boolean
}

const AGENT_TOOLS = new Set(["task", "agent", "subagent", "delegate", "spawn"])
const SHELL_TOOLS = new Set(["bash", "shell", "execute", "run", "terminal"])

/** Completed shell runs age out of the sheet; agent runs stay for the session. */
const MAX_TASKS = 40

function isToolPart(part: Part): part is ToolPart {
  return part.type === "tool"
}

/** True for the tools that spawn a sub-agent with a session of its own. */
export function isAgentToolName(tool: string): boolean {
  return AGENT_TOOLS.has(tool.toLowerCase())
}

function kindOf(tool: string): BackgroundTaskKind | null {
  const name = tool.toLowerCase()
  if (AGENT_TOOLS.has(name)) return "agent"
  if (SHELL_TOOLS.has(name)) return "shell"
  return null
}

function metadataOf(state: ToolState): Record<string, unknown> {
  return (state.metadata as Record<string, unknown> | undefined) ?? {}
}

function stringField(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function statusOf(state: ToolState): BackgroundTaskStatus {
  if (state.status === "completed") return "completed"
  if (state.status === "error") {
    // An aborted run reports as an error, but reads to the user as "stopped".
    const message = typeof state.error === "string" ? state.error.toLowerCase() : ""
    return message.includes("abort") || message.includes("cancel") ? "stopped" : "error"
  }
  return "running"
}

function titleOf(part: ToolPart, kind: BackgroundTaskKind): string {
  const state = part.state
  const metadata = metadataOf(state)
  const input = (state.input ?? {}) as Record<string, unknown>
  const stateTitle = state.status === "running" || state.status === "completed" ? state.title : undefined
  const candidate =
    stringField(metadata, "liveSummary") ||
    stateTitle ||
    stringField(input, "description") ||
    stringField(input, "prompt") ||
    stringField(input, "command")
  if (candidate) return candidate.split("\n")[0]?.slice(0, 120) ?? candidate
  return kind === "agent" ? "Agent run" : "Shell command"
}

function toolUsesOf(state: ToolState): number | undefined {
  const summary = metadataOf(state)["summary"]
  return Array.isArray(summary) ? summary.length : undefined
}

function timesOf(state: ToolState): { startedAt?: number; endedAt?: number } {
  if (state.status === "running") return { startedAt: state.time.start }
  if (state.status === "completed" || state.status === "error") {
    return { startedAt: state.time.start, endedAt: state.time.end }
  }
  return {}
}

function toTask(part: ToolPart): BackgroundTask | null {
  const kind = kindOf(part.tool)
  if (!kind) return null

  const state = part.state
  const metadata = metadataOf(state)
  const input = (state.input ?? {}) as Record<string, unknown>
  const status = statusOf(state)

  const detached = metadata["background"] === true

  // Every agent run belongs in the sheet. A shell command earns a row while it
  // is live, or after it finishes if the model detached it — otherwise the list
  // fills up with ordinary one-liners.
  if (kind === "shell" && status !== "running" && !detached) return null

  return {
    id: part.id,
    callID: part.callID,
    kind,
    title: titleOf(part, kind),
    status,
    childSessionID: stringField(metadata, "sessionId"),
    agentType: stringField(input, "subagent_type") ?? stringField(input, "agent"),
    command: kind === "shell" ? stringField(input, "command") : undefined,
    ...timesOf(state),
    toolUses: toolUsesOf(state),
    detached,
  }
}

/**
 * Every background run in the session, newest first, running runs before
 * finished ones.
 */
export function collectBackgroundTasks(messages: MessageWithParts[]): BackgroundTask[] {
  const tasks: BackgroundTask[] = []
  for (const message of messages) {
    for (const part of message.parts) {
      if (!isToolPart(part)) continue
      const task = toTask(part)
      if (task) tasks.push(task)
    }
  }

  return tasks
    .sort((a, b) => {
      const running = Number(b.status === "running") - Number(a.status === "running")
      if (running !== 0) return running
      return (b.startedAt ?? 0) - (a.startedAt ?? 0)
    })
    .slice(0, MAX_TASKS)
}

export function runningTasks(tasks: BackgroundTask[]): BackgroundTask[] {
  return tasks.filter((task) => task.status === "running")
}

export function finishedTasks(tasks: BackgroundTask[]): BackgroundTask[] {
  return tasks.filter((task) => task.status !== "running")
}

/** "3 min 41 s", "49 s" — the elapsed form used on the activity cards. */
export function durationLabel(task: BackgroundTask, now: number): string {
  if (task.startedAt === undefined) return ""
  const end = task.endedAt ?? now
  const seconds = Math.max(0, Math.round((end - task.startedAt) / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`
  const hours = Math.floor(minutes / 60)
  return `${hours} h ${minutes % 60} min`
}

/** 118_412 → "118K". Token counts are read at a glance, never exactly. */
export function formatTokenCount(total: number): string {
  if (total < 1000) return String(total)
  if (total < 10_000) return `${Math.round(total / 100) / 10}K`.replace(".0K", "K")
  if (total < 1_000_000) return `${Math.round(total / 1000)}K`
  return `${Math.round(total / 100_000) / 10}M`.replace(".0M", "M")
}

export function statusLabel(status: BackgroundTaskStatus): string {
  if (status === "running") return "Running"
  if (status === "completed") return "Completed"
  if (status === "stopped") return "Stopped"
  return "Failed"
}

export function kindLabel(task: BackgroundTask): string {
  return task.kind === "agent" ? "Agent" : "Shell"
}
