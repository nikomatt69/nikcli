/**
 * Bridge between workspace events and the unified `sync_event` log.
 *
 * Phase 0 of the unify-sessions-workspace plan routes workspace-bound
 * events (status, session.status, permission, question, …) through the
 * same `Sync.emit` / `Sync.replay` API that the session aggregates
 * already use. The bridge is the only place that knows how to address
 * the workspace aggregate in the event log: the `aggregate` column is
 * the workspace id itself, so the per-aggregate sequence number is
 * monotonically increasing per workspace.
 *
 * Why a separate module instead of inlining? The `Sync` API is generic
 * over a zod schema; workspace events have a heterogeneous payload
 * (the `properties` of an arbitrary bus event). We register the event
 * types we care about (see RESTORE_EVENT_TYPES in workspace/index.ts) and
 * pass the payload through as a generic record.
 */
import { Log } from "@/util/log"
import { Sync, type SyncEventRecord } from "@/sync"

const log = Log.create({ service: "workspace-sync-bridge" })

/**
 * Emit a workspace-bound event into the unified event log. The
 * `aggregate` is the workspace id and the `data` is the full event
 * envelope (type, properties, etc).
 */
export async function workspaceEvent(
  projectID: string,
  workspaceID: string,
  event: { type?: string; properties?: any },
): Promise<SyncEventRecord | undefined> {
  if (!event?.type) return
  try {
    return await Sync.emitRaw(projectID, workspaceID, {
      type: event.type,
      properties: event.properties ?? {},
    })
  } catch (error) {
    log.warn("failed to emit workspace event", {
      workspaceID,
      type: event.type,
      error,
    })
    return undefined
  }
}

/**
 * Emit a workspace lifecycle event (workspace.created, workspace.removed,
 * workspace.configUpdated) into the unified event log. These are the
 * events a projector needs to reconstruct the workspace row from cold
 * start.
 */
export async function workspaceLifecycle(
  projectID: string,
  workspaceID: string,
  type: "workspace.created" | "workspace.removed" | "workspace.configUpdated" | "workspace.statusChanged",
  data: Record<string, unknown>,
): Promise<SyncEventRecord | undefined> {
  try {
    return await Sync.emitRaw(projectID, workspaceID, { type, ...data })
  } catch (error) {
    log.warn("failed to emit workspace lifecycle event", {
      workspaceID,
      type,
      error,
    })
    return undefined
  }
}

/**
 * Replay all events for a workspace. Used by `buildRestorePayload` to
 * reconstruct the `events: unknown[]` field of the workspace restore
 * response. Returns events in `seq` order, oldest first.
 */
export async function workspaceEvents(workspaceID: string): Promise<unknown[]> {
  // The aggregate is the workspace id, so we read every event whose
  // aggregate equals the workspace id. We do not filter on projectID
  // here because the projection already ran for a known workspace.
  return Sync.readAggregate(workspaceID)
}

export const SyncEmit = {
  workspaceEvent,
  workspaceLifecycle,
}

export const SyncReplay = {
  workspaceEvents,
}
