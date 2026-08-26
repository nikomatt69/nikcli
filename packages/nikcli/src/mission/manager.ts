/**
 * Missions — persisted CRUD layer.
 *
 * Definitions and per-exec history live in SQL (`mission`, `mission_exec`)
 * behind `MissionRepo`; see `specs/storage/remove-json-storage.md`. They used
 * to live in the JSON tree under `["mission", projectID, missionID]` and
 * `["mission_exec", projectID, missionID, execID]`.
 *
 * The exported functions stay `async` even though every operation underneath
 * is now synchronous: the callers are async, and changing their shape is a
 * separate change from moving the storage.
 */

import { Log } from "@nikcli-ai/util/log"
import { RunSandbox } from "../worktree/sandbox"
import { MissionRepo } from "./repo"
import {
  HISTORY_LIMIT,
  generateID,
  sanitizeDefinition,
  type ExecKind,
  type FeatureStatus,
  type MilestoneStatus,
  type MissionDefinition,
  type MissionExec,
  type MissionStatus,
  type MissionWorktree,
} from "./schema"

const log = Log.create({ service: "mission.manager" })

export async function list(project: string): Promise<MissionDefinition[]> {
  return MissionRepo.list(project)
}

export async function get(project: string, id: string): Promise<MissionDefinition | undefined> {
  return MissionRepo.get(project, id)
}

export async function upsert(project: string, def: MissionDefinition): Promise<MissionDefinition> {
  const sanitized = sanitizeDefinition(def)
  if (!sanitized) throw new Error("Invalid mission definition")
  // `worktree` is orchestrator-owned state, not part of the user-editable
  // definition. Clients that round-trip a whole definition on edit omit it,
  // and dropping it would strand the mission's sandbox and branch a fresh one
  // on the next resume — so it is sticky unless the caller supplies one.
  if (!sanitized.worktree) {
    const existing = MissionRepo.get(project, sanitized.id)
    if (existing?.worktree) sanitized.worktree = existing.worktree
  }
  MissionRepo.upsert(project, sanitized)
  log.info("upsert", { id: sanitized.id, name: sanitized.name, status: sanitized.status })
  return sanitized
}

export async function remove(project: string, directory: string, id: string): Promise<boolean> {
  const existing = MissionRepo.get(project, id)
  if (!existing) return false
  MissionRepo.remove(project, id)
  // Best-effort sandbox cleanup. `release` keeps the worktree whenever it
  // still holds work, so deleting a mission never destroys its output.
  if (existing.worktree) {
    await RunSandbox.release({
      hostDirectory: directory,
      sandbox: existing.worktree,
    }).catch(() => false)
  }
  return true
}

/**
 * Record the sandbox worktree the orchestrator created for this mission so a
 * resume (or a later process) rebinds to it instead of branching a fresh one.
 */
export async function setWorktree(
  project: string,
  id: string,
  worktree: MissionWorktree,
): Promise<MissionDefinition | undefined> {
  const def = await get(project, id)
  if (!def) return undefined
  return upsert(project, { ...def, worktree })
}

export async function setStatus(
  project: string,
  id: string,
  status: MissionStatus,
): Promise<MissionDefinition | undefined> {
  const def = await get(project, id)
  if (!def) return undefined
  return upsert(project, { ...def, status })
}

/** Mutate a single feature's status/error in place. Returns the updated definition. */
export async function setFeatureStatus(
  project: string,
  id: string,
  featureID: string,
  status: FeatureStatus,
  error?: string,
): Promise<MissionDefinition | undefined> {
  const def = await get(project, id)
  if (!def) return undefined
  let found = false
  const milestones = def.milestones.map((m) => ({
    ...m,
    features: m.features.map((f) => {
      if (f.id !== featureID) return f
      found = true
      return { ...f, status, ...(error !== undefined ? { error } : status === "done" ? { error: undefined } : {}) }
    }),
  }))
  if (!found) return def
  return upsert(project, { ...def, milestones })
}

export async function setMilestoneStatus(
  project: string,
  id: string,
  milestoneID: string,
  status: MilestoneStatus,
): Promise<MissionDefinition | undefined> {
  const def = await get(project, id)
  if (!def) return undefined
  const milestones = def.milestones.map((m) => (m.id === milestoneID ? { ...m, status } : m))
  return upsert(project, { ...def, milestones })
}

// ── Execution records ─────────────────────────────────────────────────────────

export async function startExec(
  project: string,
  missionID: string,
  kind: ExecKind,
  targetID: string,
  targetName: string,
  sessionID?: string,
): Promise<MissionExec> {
  const now = Date.now()
  const exec: MissionExec = {
    id: generateID("mission_exec"),
    missionID,
    kind,
    targetID,
    targetName,
    startedAt: now,
    heartbeatAt: now,
    status: "running",
    ok: false,
  }
  // Assigned rather than spread so the key stays absent when there is no
  // session, without an empty-object spread hiding the shape.
  if (sessionID) exec.sessionID = sessionID
  MissionRepo.putExec(project, exec)
  return exec
}

export async function touchExec(project: string, missionID: string, execID: string): Promise<void> {
  try {
    MissionRepo.updateExec(project, missionID, execID, (draft) => {
      if (draft.status !== "running") return
      draft.heartbeatAt = Date.now()
    })
  } catch (error) {
    log.warn("touchExec failed", { missionID, execID, error })
  }
}

export async function attachExecSession(
  project: string,
  missionID: string,
  execID: string,
  sessionID: string,
): Promise<void> {
  try {
    MissionRepo.updateExec(project, missionID, execID, (draft) => {
      draft.sessionID = sessionID
    })
  } catch (error) {
    log.warn("attachExecSession failed", { missionID, execID, error })
  }
}

export async function finishExec(
  project: string,
  missionID: string,
  execID: string,
  patch: { status: MissionExec["status"]; ok: boolean; endedAt: number; error?: string; sessionID?: string },
): Promise<MissionExec | undefined> {
  try {
    const next = MissionRepo.updateExec(project, missionID, execID, (draft) => {
      draft.status = patch.status
      draft.ok = patch.ok
      draft.endedAt = patch.endedAt
      if (patch.error !== undefined) draft.error = patch.error
      if (patch.sessionID !== undefined) draft.sessionID = patch.sessionID
    })
    if (next === undefined) return undefined
    MissionRepo.trimExecs(project, missionID, HISTORY_LIMIT)
    return next
  } catch (error) {
    log.warn("finishExec failed", { missionID, execID, error })
    return undefined
  }
}

export async function orphanExec(
  project: string,
  missionID: string,
  execID: string,
  endedAt: number = Date.now(),
): Promise<MissionExec | undefined> {
  try {
    return MissionRepo.updateExec(project, missionID, execID, (draft) => {
      if (draft.status === "running") {
        draft.status = "orphaned"
        draft.ok = false
        draft.endedAt = endedAt
        draft.error = draft.error ?? "Process exited before the exec finished"
      }
    })
  } catch (error) {
    log.warn("orphanExec failed", { missionID, execID, error })
    return undefined
  }
}

export async function listRunningExecs(project: string): Promise<MissionExec[]> {
  return MissionRepo.listExecsByStatus(project, "running")
}

export async function listExecs(project: string, missionID: string, limit = HISTORY_LIMIT): Promise<MissionExec[]> {
  return MissionRepo.listExecs(project, missionID, limit)
}
