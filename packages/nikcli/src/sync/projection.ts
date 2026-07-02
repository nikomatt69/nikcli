/**
 * Production entry point for snapshot-backed projections.
 *
 * `SyncReducer.replayWithSnapshot` is the mechanism; this module supplies
 * the domain wiring: the empty state per aggregate kind, the projector
 * chain, and prefix-based dispatch (`wrk_…` → workspace, `ses_…` →
 * session) used by the `/sync/snapshot/:aggregateID` cold-start endpoint
 * and by the session bridge's write-through refresh.
 */
import { SyncReducer } from "./reducer"
import { SyncProjector, type SessionState, type WorkspaceState } from "./projector"

export namespace SyncProjection {
  export async function workspace(
    projectID: string,
    workspaceID: string,
  ): Promise<{ state: WorkspaceState; lastSeq: number }> {
    return SyncReducer.replayWithSnapshot<WorkspaceState>(
      { projectID, aggregate: workspaceID, aggregateID: workspaceID },
      {
        id: workspaceID,
        projectID,
        name: "",
        branch: null,
        config: null,
        lastTouchedAt: 0,
      },
      [SyncProjector.workspace],
    )
  }

  export async function session(
    projectID: string,
    sessionID: string,
  ): Promise<{ state: SessionState; lastSeq: number }> {
    return SyncReducer.replayWithSnapshot<SessionState>(
      { projectID, aggregate: sessionID, aggregateID: sessionID },
      {
        id: sessionID,
        projectID,
        title: "",
        lastTouchedAt: 0,
      },
      [SyncProjector.session],
    )
  }

  /**
   * Cold-start projection dispatch by aggregate id prefix. Returns
   * undefined for aggregate kinds without a registered projector.
   */
  export async function byAggregate(
    projectID: string,
    aggregateID: string,
  ): Promise<{ state: unknown; lastSeq: number } | undefined> {
    if (aggregateID.startsWith("wrk")) return workspace(projectID, aggregateID)
    if (aggregateID.startsWith("ses")) return session(projectID, aggregateID)
    return undefined
  }
}
