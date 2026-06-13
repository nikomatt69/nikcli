/**
 * Missions — persisted CRUD layer.
 *
 * Definitions live in `Storage` under `["mission", projectID, missionID]`;
 * execution history under `["mission_exec", projectID, missionID, execID]`.
 * All writes are guarded by sanitization so corrupt or partial records are
 * dropped, not surfaced. Mirrors `src/loop/manager.ts`.
 */

import { Effect } from "effect"
import { runPromiseWithLayer } from "../effect"
import { Instance } from "../project/instance"
import { Storage } from "../storage/storage"
import { Log } from "../util/log"
import {
  HISTORY_LIMIT,
  generateID,
  sanitizeDefinition,
  sanitizeExec,
  type ExecKind,
  type FeatureStatus,
  type MilestoneStatus,
  type MissionDefinition,
  type MissionExec,
  type MissionStatus,
} from "./schema"

const log = Log.create({ service: "mission.manager" })

function runStorage<A, E>(effect: Effect.Effect<A, E, Storage.Service>) {
  return runPromiseWithLayer(Storage.defaultLayer, effect)
}

function defKey(id: string): string[] {
  return ["mission", Instance.project.id, id]
}
function defListPrefix(): string[] {
  return ["mission", Instance.project.id]
}
function execKey(missionID: string, execID: string): string[] {
  return ["mission_exec", Instance.project.id, missionID, execID]
}
function execListPrefix(missionID: string): string[] {
  return ["mission_exec", Instance.project.id, missionID]
}
function execListAllPrefix(): string[] {
  return ["mission_exec", Instance.project.id]
}

function readAllByPrefix(prefix: string[]): Promise<unknown[]> {
  return runStorage(
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      const keys = yield* storage.list(prefix)
      return yield* Effect.forEach(
        keys,
        (k) => storage.read<unknown>(k).pipe(Effect.catch(() => Effect.succeed(undefined))),
        { concurrency: 10 },
      )
    }),
  ).catch(() => [] as unknown[])
}

async function readExecsByPrefix(prefix: string[]): Promise<MissionExec[]> {
  const records = await readAllByPrefix(prefix)
  return records.map(sanitizeExec).filter((r): r is MissionExec => r !== undefined)
}

async function readDef(id: string): Promise<MissionDefinition | undefined> {
  try {
    const raw = await runStorage(
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        return yield* storage.read<unknown>(defKey(id))
      }),
    )
    return sanitizeDefinition(raw)
  } catch (error) {
    if (error instanceof Storage.NotFoundError) return undefined
    log.warn("read mission failed", { id, error })
    return undefined
  }
}

async function writeDef(def: MissionDefinition): Promise<void> {
  await runStorage(
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      yield* storage.write(defKey(def.id), def)
    }),
  )
}

async function removeDef(id: string): Promise<void> {
  await runStorage(
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      yield* storage.remove(defKey(id))
    }),
  )
}

export async function list(): Promise<MissionDefinition[]> {
  const records = await readAllByPrefix(defListPrefix())
  return records
    .map(sanitizeDefinition)
    .filter((r): r is MissionDefinition => r !== undefined)
    .sort((a, b) => b.createdAt - a.createdAt)
}

export async function get(id: string): Promise<MissionDefinition | undefined> {
  return readDef(id)
}

export async function upsert(def: MissionDefinition): Promise<MissionDefinition> {
  const sanitized = sanitizeDefinition(def)
  if (!sanitized) throw new Error("Invalid mission definition")
  await writeDef(sanitized)
  log.info("upsert", { id: sanitized.id, name: sanitized.name, status: sanitized.status })
  return sanitized
}

export async function remove(id: string): Promise<boolean> {
  const existing = await get(id)
  if (!existing) return false
  await removeDef(id)
  // Cascade: drop every exec record so we don't leak orphan entries.
  await runStorage(
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      const execKeys = yield* storage.list(execListPrefix(id))
      yield* Effect.forEach(
        execKeys,
        (key) => storage.remove(key).pipe(Effect.catch(() => Effect.succeed(undefined))),
        { concurrency: 10 },
      )
    }),
  ).catch(() => {})
  return true
}

export async function setStatus(id: string, status: MissionStatus): Promise<MissionDefinition | undefined> {
  const def = await get(id)
  if (!def) return undefined
  return upsert({ ...def, status })
}

/** Mutate a single feature's status/error in place. Returns the updated definition. */
export async function setFeatureStatus(
  id: string,
  featureID: string,
  status: FeatureStatus,
  error?: string,
): Promise<MissionDefinition | undefined> {
  const def = await get(id)
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
  return upsert({ ...def, milestones })
}

export async function setMilestoneStatus(
  id: string,
  milestoneID: string,
  status: MilestoneStatus,
): Promise<MissionDefinition | undefined> {
  const def = await get(id)
  if (!def) return undefined
  const milestones = def.milestones.map((m) => (m.id === milestoneID ? { ...m, status } : m))
  return upsert({ ...def, milestones })
}

// ── Execution records ─────────────────────────────────────────────────────────

export async function startExec(
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
    ...(sessionID ? { sessionID } : {}),
  }
  await runStorage(
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      yield* storage.write(execKey(missionID, exec.id), exec)
    }),
  )
  return exec
}

export async function touchExec(missionID: string, execID: string): Promise<void> {
  try {
    await runStorage(
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        yield* storage.update<MissionExec>(execKey(missionID, execID), (draft) => {
          if (draft.status !== "running") return
          draft.heartbeatAt = Date.now()
        })
      }),
    )
  } catch (error) {
    log.warn("touchExec failed", { missionID, execID, error })
  }
}

export async function attachExecSession(missionID: string, execID: string, sessionID: string): Promise<void> {
  try {
    await runStorage(
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        yield* storage.update<MissionExec>(execKey(missionID, execID), (draft) => {
          draft.sessionID = sessionID
        })
      }),
    )
  } catch (error) {
    log.warn("attachExecSession failed", { missionID, execID, error })
  }
}

export async function finishExec(
  missionID: string,
  execID: string,
  patch: { status: MissionExec["status"]; ok: boolean; endedAt: number; error?: string; sessionID?: string },
): Promise<MissionExec | undefined> {
  try {
    const next = await runStorage(
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        return yield* storage.update<MissionExec>(execKey(missionID, execID), (draft) => {
          draft.status = patch.status
          draft.ok = patch.ok
          draft.endedAt = patch.endedAt
          if (patch.error !== undefined) draft.error = patch.error
          if (patch.sessionID !== undefined) draft.sessionID = patch.sessionID
        })
      }),
    )
    await trimExecs(missionID)
    return next
  } catch (error) {
    log.warn("finishExec failed", { missionID, execID, error })
    return undefined
  }
}

export async function orphanExec(
  missionID: string,
  execID: string,
  endedAt: number = Date.now(),
): Promise<MissionExec | undefined> {
  try {
    return await runStorage(
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        return yield* storage.update<MissionExec>(execKey(missionID, execID), (draft) => {
          if (draft.status === "running") {
            draft.status = "orphaned"
            draft.ok = false
            draft.endedAt = endedAt
            draft.error = draft.error ?? "Process exited before the exec finished"
          }
        })
      }),
    )
  } catch (error) {
    log.warn("orphanExec failed", { missionID, execID, error })
    return undefined
  }
}

export async function listRunningExecs(): Promise<MissionExec[]> {
  const records = await readExecsByPrefix(execListAllPrefix())
  return records.filter((r) => r.status === "running")
}

export async function listExecs(missionID: string, limit = HISTORY_LIMIT): Promise<MissionExec[]> {
  const records = await readExecsByPrefix(execListPrefix(missionID))
  return records.sort((a, b) => b.startedAt - a.startedAt).slice(0, limit)
}

async function trimExecs(missionID: string): Promise<void> {
  await runStorage(
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      const keys = yield* storage.list(execListPrefix(missionID))
      if (keys.length <= HISTORY_LIMIT) return
      const records = yield* Effect.forEach(
        keys,
        (k) =>
          storage.read<unknown>(k).pipe(
            Effect.map(sanitizeExec),
            Effect.catch(() => Effect.succeed(undefined)),
          ),
        { concurrency: 10 },
      )
      const sortable = records.filter((r): r is MissionExec => r !== undefined)
      sortable.sort((a, b) => a.startedAt - b.startedAt)
      const toDrop = sortable.slice(0, sortable.length - HISTORY_LIMIT)
      yield* Effect.forEach(
        toDrop,
        (r) => storage.remove(execKey(missionID, r.id)).pipe(Effect.catch(() => Effect.succeed(undefined))),
        { concurrency: 10 },
      )
    }),
  ).catch(() => {})
}
