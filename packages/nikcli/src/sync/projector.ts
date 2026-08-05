/**
 * Projector functions — pure reducers that turn a `SyncEventRecord` into
 * a domain state update. They are the inverse of the domain's command
 * side: where `Workspace.create(...)` and `Session.update(...)` produce
 * a row + an event, the projector here consumes an event and yields the
 * same row.
 *
 * Projectors must be:
 *  - Pure: no I/O, no Date.now(), no random
 *  - Total: must return a valid state for any event (ignore unknown types)
 *  - Composable: `Sync.replayWithSnapshot` chains multiple projectors
 *
 * The state shape is intentionally narrow — just the fields a cold start
 * needs to reconstruct the row. Anything else (full messages, snapshots)
 * lives in its own table and is fetched on demand.
 */
import type { SyncEventRecord } from "./index"

export type WorkspaceState = {
  id: string
  projectID: string
  name: string
  branch: string | null
  config: unknown
  status?: string
  removed?: boolean
  timeUsed?: number
  lastTouchedAt: number
}

export type SessionState = {
  id: string
  projectID: string
  workspaceID?: string
  title: string
  parentID?: string
  lastTouchedAt: number
}

export type PermissionState = {
  id: string
  asked: boolean
  replied: boolean
  lastTouchedAt: number
}

export type QuestionState = {
  id: string
  asked: boolean
  replied: boolean
  rejected: boolean
  lastTouchedAt: number
}

const SESSION_EVENT_TYPES = new Set([
  "session.created",
  "session.updated",
  "session.deleted",
  "session.status",
  "session.idle",
])

/**
 * Rows written by `SyncEvent` carry a versioned type (`session.updated.1`)
 * so old versions stay replayable; rows written by the legacy bridges carry
 * the bare type. Matching happens on the bare form.
 */
function baseType(type: string): string {
  const dot = type.lastIndexOf(".")
  if (dot < 0) return type
  return /^\d+$/.test(type.slice(dot + 1)) ? type.slice(0, dot) : type
}

const PERMISSION_EVENT_TYPES = new Set(["permission.asked", "permission.replied"])

const QUESTION_EVENT_TYPES = new Set(["question.asked", "question.replied", "question.rejected"])

export const SyncProjector = {
  workspace: (state: WorkspaceState, event: SyncEventRecord): WorkspaceState => {
    if (!event.data || typeof event.data !== "object") return state
    const data = event.data as Record<string, any>
    const type = data.type
    switch (type) {
      case "workspace.created": {
        return {
          ...state,
          id: event.aggregate,
          projectID: event.projectId,
          name: typeof data.name === "string" ? data.name : state.name,
          branch: data.branch !== undefined ? data.branch : (state.branch ?? null),
          config: data.config ?? state.config,
          removed: false,
          timeUsed: typeof data.timeUsed === "number" ? data.timeUsed : state.timeUsed,
          lastTouchedAt: event.timestamp,
        }
      }
      case "workspace.configUpdated": {
        return {
          ...state,
          config: data.config ?? state.config,
          // Explicit null clears the branch (worktree went detached);
          // undefined means "unchanged".
          branch: data.branch !== undefined ? data.branch : state.branch,
          lastTouchedAt: event.timestamp,
        }
      }
      case "workspace.statusChanged": {
        return {
          ...state,
          status: typeof data.status === "string" ? data.status : state.status,
          lastTouchedAt: event.timestamp,
        }
      }
      case "workspace.removed": {
        return { ...state, removed: true, lastTouchedAt: event.timestamp }
      }
      default:
        return state
    }
  },

  session: (state: SessionState, event: SyncEventRecord): SessionState => {
    if (!event.data || typeof event.data !== "object") return state
    if (!SESSION_EVENT_TYPES.has(baseType(event.type))) return state
    const data = event.data as Record<string, any>
    // Three shapes reach here: the flat legacy payload, the bridge's
    // `{ type, properties }` envelope, and `SyncEvent`'s `{ sessionID, info }`.
    const source = data.info ?? data.properties ?? data
    return {
      ...state,
      id: event.aggregate,
      projectID: event.projectId,
      workspaceID: Object.hasOwn(source, "workspaceID") ? (source.workspaceID ?? undefined) : state.workspaceID,
      title: source.title ?? state.title,
      parentID: source.parentID ?? state.parentID,
      lastTouchedAt: event.timestamp,
    }
  },

  permission: (state: PermissionState, event: SyncEventRecord): PermissionState => {
    if (!PERMISSION_EVENT_TYPES.has(baseType(event.type))) return state
    const data = event.data as Record<string, any>
    const id = (data.id as string | undefined) ?? event.aggregate
    return {
      ...state,
      id,
      asked: event.type === "permission.asked" ? true : state.asked,
      replied: event.type === "permission.replied" ? true : state.replied,
      lastTouchedAt: event.timestamp,
    }
  },

  question: (state: QuestionState, event: SyncEventRecord): QuestionState => {
    if (!QUESTION_EVENT_TYPES.has(baseType(event.type))) return state
    const data = event.data as Record<string, any>
    const id = (data.id as string | undefined) ?? event.aggregate
    return {
      ...state,
      id,
      asked: event.type === "question.asked" ? true : state.asked,
      replied: event.type === "question.replied" ? true : state.replied,
      rejected: event.type === "question.rejected" ? true : state.rejected,
      lastTouchedAt: event.timestamp,
    }
  },
}
