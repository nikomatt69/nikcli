/**
 * Bridge between workspace restore events and the unified `sync_event` log.
 *
 * Workspace lifecycle events live in `workspace/projection.ts`, which owns
 * the seam from `sync_event` to the `workspace` row projection. This bridge
 * only journals heterogeneous restore events observed from workspace buses.
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
}
