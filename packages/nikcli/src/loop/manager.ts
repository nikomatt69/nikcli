/**
 * Loops — persisted CRUD layer.
 *
 * Definitions and per-run history live in SQL (`loop`, `loop_run`) behind
 * `LoopRepo`; see `specs/storage/remove-json-storage.md`. They used to live in
 * the JSON tree under `["loop", projectID, loopID]` and
 * `["loop_run", projectID, loopID, runID]`.
 *
 * The exported functions stay `async` even though every operation underneath
 * is now synchronous: the callers are async, and changing their shape is a
 * separate change from moving the storage.
 */

import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { RunSandbox } from "../worktree/sandbox"
import { LoopRepo } from "./repo"
import {
  HISTORY_LIMIT,
  generateID,
  sanitizeDefinition,
  type LoopDefinition,
  type LoopPullRequestRef,
  type LoopRun,
  type LoopWorktree,
} from "./schema"

const log = Log.create({ service: "loop.manager" })

function projectID(): string {
  return Instance.project.id
}

export async function list(): Promise<LoopDefinition[]> {
  return LoopRepo.list(projectID())
}

export async function get(id: string): Promise<LoopDefinition | undefined> {
  return LoopRepo.get(projectID(), id)
}

export async function upsert(def: LoopDefinition): Promise<LoopDefinition> {
  const sanitized = sanitizeDefinition(def)
  if (!sanitized) throw new Error("Invalid loop definition")
  const project = projectID()
  // `worktree` is engine-owned state, not part of the user-editable
  // definition. Clients that round-trip a whole definition on edit (the TUI
  // dialog, a REST PUT) omit it, and dropping it would strand the loop's
  // sandbox and branch a fresh one on the next run — so it is sticky unless
  // the caller explicitly supplies one.
  if (!sanitized.worktree) {
    const existing = LoopRepo.get(project, sanitized.id)
    if (existing?.worktree) sanitized.worktree = existing.worktree
  }
  LoopRepo.upsert(project, sanitized)
  log.info("upsert", {
    id: sanitized.id,
    name: sanitized.name,
    trigger: sanitized.trigger.kind,
  })
  return sanitized
}

export async function remove(id: string): Promise<boolean> {
  const project = projectID()
  const existing = LoopRepo.get(project, id)
  if (!existing) return false
  // Cascade: the definition and every run it owns go in one transaction, so a
  // crash cannot leave runs pointing at a loop that no longer exists.
  LoopRepo.remove(project, id)
  // Best-effort sandbox cleanup. `release` keeps the worktree whenever it
  // still holds work, so deleting a loop never destroys an agent's output.
  if (existing.worktree) {
    await RunSandbox.release({
      hostDirectory: Instance.directory,
      sandbox: existing.worktree,
    }).catch(() => false)
  }
  return true
}

export async function setEnabled(id: string, enabled: boolean): Promise<LoopDefinition | undefined> {
  const def = await get(id)
  if (!def) return undefined
  const next: LoopDefinition = { ...def, enabled }
  return upsert(next)
}

/**
 * Record the sandbox worktree the engine created for this loop so later runs
 * (and later processes) rebind to it instead of branching a fresh one.
 */
export async function setWorktree(id: string, worktree: LoopWorktree): Promise<LoopDefinition | undefined> {
  const def = await get(id)
  if (!def) return undefined
  return upsert({ ...def, worktree })
}

export async function setPaused(id: string, paused: boolean): Promise<LoopDefinition | undefined> {
  const def = await get(id)
  if (!def) return undefined
  const next: LoopDefinition = { ...def, paused }
  return upsert(next)
}

/**
 * Mark a `running` run as `orphaned` (process died mid-run; recovered on next
 * boot). Returns the updated run, or `undefined` if the run was not found.
 */
export async function orphanRun(
  loopID: string,
  runID: string,
  endedAt: number = Date.now(),
): Promise<LoopRun | undefined> {
  try {
    return LoopRepo.updateRun(projectID(), loopID, runID, (draft) => {
      if (draft.status === "running") {
        draft.status = "orphaned"
        draft.ok = false
        draft.endedAt = endedAt
        draft.error = draft.error ?? "Process exited before the run finished"
      }
    })
  } catch (error) {
    log.warn("orphanRun failed", { loopID, runID, error })
    return undefined
  }
}

/** Find every run across every loop that is still in `"running"` status. */
export async function listRunningRuns(): Promise<LoopRun[]> {
  return LoopRepo.listRunsByStatus(projectID(), "running")
}

// ── Run counter ───────────────────────────────────────────────────────────────

/**
 * Lifetime number of started runs. Backed by the `started_runs` counter, not
 * the run history (which `trimRuns` caps at HISTORY_LIMIT), so `maxRuns`
 * larger than the history window still triggers. A null counter is
 * initialized from the surviving history records (one-time migration for
 * pre-counter loops).
 */
export async function countRuns(loopID: string): Promise<number> {
  const project = projectID()
  const counted = LoopRepo.startedRuns(project, loopID)
  if (counted !== undefined) return counted
  const fromHistory = LoopRepo.countRunRecords(project, loopID)
  try {
    LoopRepo.setStartedRuns(project, loopID, fromHistory)
  } catch (error) {
    log.warn("run counter seed failed", { loopID, error })
  }
  return fromHistory
}

/** Overwrite the lifetime run counter. Used after manual run cap edits. */
export async function resetRunCounter(loopID: string, startedRuns = 0): Promise<void> {
  try {
    LoopRepo.setStartedRuns(projectID(), loopID, startedRuns)
  } catch (error) {
    log.warn("resetRunCounter failed", { loopID, error })
  }
}

// ── Runs ──────────────────────────────────────────────────────────────────────

export async function startRun(loopID: string, sessionID?: string): Promise<LoopRun> {
  const project = projectID()
  const now = Date.now()
  const run: LoopRun = {
    id: generateID("loop_run"),
    loopID,
    startedAt: now,
    heartbeatAt: now,
    status: "running",
    ok: false,
    ...(sessionID ? { sessionID } : {}),
  }
  LoopRepo.putRun(project, run)
  // Bump the lifetime counter; on first contact derive it from history (the
  // record above is already included in that count).
  try {
    if (LoopRepo.incrementStartedRuns(project, loopID) === undefined) {
      LoopRepo.setStartedRuns(project, loopID, LoopRepo.countRunRecords(project, loopID))
    }
  } catch (error) {
    log.warn("run counter bump failed", { loopID, error })
  }
  return run
}

/** Renew the lease on a running run. No-op if the run already finished. */
export async function touchRun(loopID: string, runID: string): Promise<void> {
  try {
    LoopRepo.updateRun(projectID(), loopID, runID, (draft) => {
      if (draft.status !== "running") return
      draft.heartbeatAt = Date.now()
    })
  } catch (error) {
    log.warn("touchRun failed", { loopID, runID, error })
  }
}

/** Attach the session to a running run without touching status/endedAt. */
export async function attachRunSession(loopID: string, runID: string, sessionID: string): Promise<void> {
  try {
    LoopRepo.updateRun(projectID(), loopID, runID, (draft) => {
      draft.sessionID = sessionID
    })
  } catch (error) {
    log.warn("attachRunSession failed", { loopID, runID, error })
  }
}

/** Persist the auto-created/updated GitHub PR reference onto a finished run. */
export async function attachRunPullRequest(
  loopID: string,
  runID: string,
  pullRequest: LoopPullRequestRef,
): Promise<void> {
  try {
    LoopRepo.updateRun(projectID(), loopID, runID, (draft) => {
      draft.pullRequest = pullRequest
    })
  } catch (error) {
    log.warn("attachRunPullRequest failed", { loopID, runID, error })
  }
}

export async function finishRun(
  loopID: string,
  runID: string,
  patch: {
    status: LoopRun["status"]
    ok: boolean
    endedAt: number
    error?: string
    sessionID?: string
  },
): Promise<LoopRun | undefined> {
  const project = projectID()
  try {
    const next = LoopRepo.updateRun(project, loopID, runID, (draft) => {
      draft.status = patch.status
      draft.ok = patch.ok
      draft.endedAt = patch.endedAt
      if (patch.error !== undefined) draft.error = patch.error
      if (patch.sessionID !== undefined) draft.sessionID = patch.sessionID
    })
    if (next === undefined) return undefined
    LoopRepo.trimRuns(project, loopID, HISTORY_LIMIT)
    return next
  } catch (error) {
    log.warn("finishRun failed", { loopID, runID, error })
    return undefined
  }
}

export async function listRuns(loopID: string, limit = HISTORY_LIMIT): Promise<LoopRun[]> {
  return LoopRepo.listRuns(projectID(), loopID, limit)
}

export async function listAllRunsAcrossLoops(limit = 100): Promise<LoopRun[]> {
  return LoopRepo.listRunsByProject(projectID(), limit)
}
