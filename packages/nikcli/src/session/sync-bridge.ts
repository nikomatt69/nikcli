/**
 * Bridge between local session activity and the unified `sync_event` log.
 *
 * The workspace event loop already journals events for sessions that live
 * inside a workspace (aggregate = workspace id). This bridge covers the
 * other half of the "one backend for sessions + workspaces" goal: sessions
 * of the local instance that are NOT bound to a workspace. Their restore
 * events (created/updated/deleted/status/idle, permission and question
 * asks/replies) are journaled under the session id as aggregate, so any
 * client — mobile resume, remote hub, a second machine — can catch up
 * from the same sequenced log it already uses for workspaces.
 *
 * Workspace-bound sessions are skipped here: the workspace loop owns them,
 * and journaling them twice would inflate the log with duplicates.
 */
import { Bus } from "@/bus"
import { Instance } from "@/project/instance"
import { Log } from "@nikcli-ai/util/log"
import { Sync } from "@/sync"
import { SNAPSHOT_INTERVAL } from "@/sync/snapshot"
import { SessionRepo } from "./repo"

const log = Log.create({ service: "session-sync-bridge" })

/**
 * Client-facing restore events that are *not* already journaled by
 * `SyncEvent`.
 *
 * session.created / updated / deleted used to be journaled here off the bus.
 * They are sync events now (session/projectors.ts), so they land in the log
 * transactionally with the write — journaling them again off the bus would
 * duplicate every row and inflate the sequence.
 */
const JOURNAL_EVENT_TYPES = new Set([
  "session.status",
  "session.idle",
  "permission.asked",
  "permission.replied",
  "question.asked",
  "question.replied",
  "question.rejected",
])

function eventSessionID(properties: any): string | undefined {
  if (!properties || typeof properties !== "object") return
  if (typeof properties.sessionID === "string") return properties.sessionID
  if (typeof properties.info?.id === "string" && properties.info.id.startsWith("ses")) return properties.info.id
  if (typeof properties.info?.sessionID === "string") return properties.info.sessionID
}

export namespace SessionSyncBridge {
  // Write-through snapshotting (plan 1.4): every SNAPSHOT_INTERVAL journaled
  // events per session, refresh the projection snapshot so a cold start
  // replays a bounded tail instead of the whole aggregate. Counters are
  // in-memory per process; losing them only delays a refresh — the reducer
  // re-snapshots on read anyway.
  const journaled = new Map<string, number>()
  const JOURNAL_COUNTER_CAP = 10_000

  function maybeSnapshot(projectID: string, sessionID: string) {
    const count = (journaled.get(sessionID) ?? 0) + 1
    if (journaled.size > JOURNAL_COUNTER_CAP && !journaled.has(sessionID)) journaled.clear()
    journaled.set(sessionID, count)
    if (count % SNAPSHOT_INTERVAL !== 0) return
    void import("@/sync/projection")
      .then(({ SyncProjection }) => SyncProjection.session(projectID, sessionID))
      .catch((error) => {
        log.warn("session snapshot refresh failed", { sessionID, error })
      })
  }

  /**
   * Subscribe the current instance's bus to the unified log. Returns the
   * unsubscribe function; the caller registers it as an instance disposer.
   */
  export function init(): () => void {
    const projectID = Instance.project.id
    return Bus.subscribeAll((event: { type?: string; properties?: any }) => {
      if (!event?.type || !JOURNAL_EVENT_TYPES.has(event.type)) return
      const sessionID = eventSessionID(event.properties)
      if (!sessionID) return

      // Workspace-bound sessions are journaled by the workspace event loop
      // under the workspace aggregate; a missing row (already-deleted
      // session emitting session.deleted) is journaled as local.
      const session = SessionRepo.get(sessionID)
      if (session?.workspaceID) return

      void Sync.emitRaw(projectID, sessionID, {
        type: event.type,
        properties: event.properties ?? {},
      })
        .then(() => maybeSnapshot(projectID, sessionID))
        .catch((error) => {
          log.warn("session event journal failed", {
            sessionID,
            type: event.type,
            error,
          })
        })
    })
  }
}
