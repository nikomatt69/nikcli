import { Log } from "@/util/log"
import { Sync, type SyncEventRecord } from "@/sync"
import { SyncProjection } from "@/sync/projection"
import { Config } from "./config"
import { WorkspaceDB } from "./db"

const log = Log.create({ service: "workspace-projection" })

export namespace WorkspaceProjection {
  export type LifecycleType =
    | "workspace.created"
    | "workspace.removed"
    | "workspace.configUpdated"
    | "workspace.statusChanged"

  export type ProjectResult = {
    record?: SyncEventRecord
    lastSeq: number
    info?: WorkspaceDB.Info
    removed: boolean
  }

  export async function emitLifecycle(
    projectID: string,
    workspaceID: string,
    type: LifecycleType,
    data: Record<string, unknown>,
  ): Promise<ProjectResult> {
    const record = await Sync.emitRaw(projectID, workspaceID, { type, ...data }, { workspaceID })
    const projected = await project(projectID, workspaceID)
    return { ...projected, record: { ...record, workspaceId: workspaceID } }
  }

  export async function project(projectID: string, workspaceID: string): Promise<ProjectResult> {
    const { state, lastSeq } = await SyncProjection.workspace(projectID, workspaceID)

    if (state.removed) {
      WorkspaceDB.remove(workspaceID)
      return { lastSeq, removed: true }
    }

    if (!state.config || state.lastTouchedAt === 0) return { lastSeq, removed: false }

    const parsedConfig = Config.safeParse(state.config)
    if (!parsedConfig.success) {
      log.warn("workspace projection skipped invalid config", {
        projectID,
        workspaceID,
        error: parsedConfig.error.message,
      })
      return { lastSeq, removed: false }
    }

    const existing = WorkspaceDB.get(workspaceID)
    const info: WorkspaceDB.Info = {
      id: workspaceID,
      projectID: state.projectID || projectID,
      name: state.name ?? existing?.name ?? "",
      branch: state.branch ?? null,
      config: parsedConfig.data,
      timeUsed: state.timeUsed ?? existing?.timeUsed ?? state.lastTouchedAt,
    }

    WorkspaceDB.upsert(info)
    if (state.status) WorkspaceDB.setStatusColumn(workspaceID, state.status)
    return { lastSeq, info, removed: false }
  }

  export async function events(workspaceID: string): Promise<unknown[]> {
    return Sync.readAggregate(workspaceID)
  }
}
