/**
 * Loops — persisted CRUD layer.
 *
 * Definitions live in `Storage` under `["loop", projectID, loopID]`; per-run
 * history under `["loop_run", projectID, loopID, runID]`. All writes are guarded
 * by sanitization so corrupt or partial records are dropped, not surfaced.
 */

import { Effect } from "effect"
import { runPromiseWithLayer } from "../effect"
import { Instance } from "../project/instance"
import { Storage } from "../storage/storage"
import { Log } from "../util/log"
import { HISTORY_LIMIT, generateID, sanitizeDefinition, sanitizeRun, type LoopDefinition, type LoopRun } from "./schema"

const log = Log.create({ service: "loop.manager" })

function runStorage<A, E>(effect: Effect.Effect<A, E, Storage.Service>) {
  return runPromiseWithLayer(Storage.defaultLayer, effect)
}

function defKey(id: string): string[] {
  return ["loop", Instance.project.id, id]
}

function defListPrefix(): string[] {
  return ["loop", Instance.project.id]
}

function runKey(loopID: string, runID: string): string[] {
  return ["loop_run", Instance.project.id, loopID, runID]
}

function runListPrefix(loopID: string): string[] {
  return ["loop_run", Instance.project.id, loopID]
}

function runListAllPrefix(): string[] {
  return ["loop_run", Instance.project.id]
}

async function readDef(id: string): Promise<LoopDefinition | undefined> {
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
    log.warn("read loop failed", { id, error })
    return undefined
  }
}

async function writeDef(def: LoopDefinition): Promise<void> {
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

async function listDefKeys(): Promise<string[][]> {
  return runStorage(
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      return yield* storage.list(defListPrefix())
    }),
  )
}

export async function list(): Promise<LoopDefinition[]> {
  const keys = await listDefKeys()
  const records = await Promise.all(keys.map((k) => readDef(k[2])))
  return records.filter((r): r is LoopDefinition => r !== undefined).sort((a, b) => b.createdAt - a.createdAt)
}

export async function get(id: string): Promise<LoopDefinition | undefined> {
  return readDef(id)
}

export async function upsert(def: LoopDefinition): Promise<LoopDefinition> {
  const sanitized = sanitizeDefinition(def)
  if (!sanitized) throw new Error("Invalid loop definition")
  await writeDef(sanitized)
  log.info("upsert", {
    id: sanitized.id,
    name: sanitized.name,
    trigger: sanitized.trigger.kind,
  })
  return sanitized
}

export async function remove(id: string): Promise<boolean> {
  const existing = await get(id)
  if (!existing) return false
  await removeDef(id)
  // Cascade: drop every run record for this loop so we don't leak orphan entries.
  const runKeys = await runStorage(
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      return yield* storage.list(runListPrefix(id))
    }),
  )
  for (const key of runKeys) {
    await runStorage(
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        yield* storage.remove(key)
      }),
    ).catch(() => {})
  }
  return true
}

export async function setEnabled(id: string, enabled: boolean): Promise<LoopDefinition | undefined> {
  const def = await get(id)
  if (!def) return undefined
  const next: LoopDefinition = { ...def, enabled }
  return upsert(next)
}

export async function countRuns(loopID: string): Promise<number> {
  try {
    const keys = await runStorage(
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        return yield* storage.list(runListPrefix(loopID))
      }),
    )
    return keys.length
  } catch {
    return 0
  }
}

// ── Runs ──────────────────────────────────────────────────────────────────────

export async function startRun(loopID: string, sessionID?: string, backgroundRunID?: string): Promise<LoopRun> {
  const run: LoopRun = {
    id: generateID("loop_run"),
    loopID,
    startedAt: Date.now(),
    status: "running",
    ok: false,
    ...(sessionID ? { sessionID } : {}),
    ...(backgroundRunID ? { backgroundRunID } : {}),
  }
  await runStorage(
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      yield* storage.write(runKey(loopID, run.id), run)
    }),
  )
  return run
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
  try {
    const next = await runStorage(
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        return yield* storage.update<LoopRun>(runKey(loopID, runID), (draft) => {
          draft.status = patch.status
          draft.ok = patch.ok
          draft.endedAt = patch.endedAt
          if (patch.error !== undefined) draft.error = patch.error
          if (patch.sessionID !== undefined) draft.sessionID = patch.sessionID
        })
      }),
    )
    await trimRuns(loopID)
    return next
  } catch (error) {
    log.warn("finishRun failed", { loopID, runID, error })
    return undefined
  }
}

async function trimRuns(loopID: string): Promise<void> {
  const keys = await runStorage(
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      return yield* storage.list(runListPrefix(loopID))
    }),
  ).catch(() => [] as string[][])
  if (keys.length <= HISTORY_LIMIT) return
  // Drop oldest (filenames end with `${runID}.json`; the trailing .json is stripped
  // by listImpl, so the last segment is the runID).
  const records = await Promise.all(
    keys.map(async (k) => {
      try {
        const raw = await runStorage(
          Effect.gen(function* () {
            const storage = yield* Storage.Service
            return yield* storage.read<LoopRun>(k)
          }),
        )
        return sanitizeRun(raw)
      } catch {
        return undefined
      }
    }),
  )
  const sortable = records.filter((r): r is LoopRun => r !== undefined)
  sortable.sort((a, b) => a.startedAt - b.startedAt)
  const toDrop = sortable.slice(0, sortable.length - HISTORY_LIMIT)
  for (const r of toDrop) {
    await runStorage(
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        yield* storage.remove(runKey(loopID, r.id))
      }),
    ).catch(() => {})
  }
}

export async function listRuns(loopID: string, limit = HISTORY_LIMIT): Promise<LoopRun[]> {
  const keys = await runStorage(
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      return yield* storage.list(runListPrefix(loopID))
    }),
  ).catch(() => [] as string[][])
  const records = await Promise.all(
    keys.map(async (k) => {
      try {
        const raw = await runStorage(
          Effect.gen(function* () {
            const storage = yield* Storage.Service
            return yield* storage.read<unknown>(k)
          }),
        )
        return sanitizeRun(raw)
      } catch {
        return undefined
      }
    }),
  )
  return records
    .filter((r): r is LoopRun => r !== undefined)
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, limit)
}

export async function listAllRunsAcrossLoops(limit = 100): Promise<LoopRun[]> {
  const keys = await runStorage(
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      return yield* storage.list(runListAllPrefix())
    }),
  ).catch(() => [] as string[][])
  const records = await Promise.all(
    keys.map(async (k) => {
      try {
        const raw = await runStorage(
          Effect.gen(function* () {
            const storage = yield* Storage.Service
            return yield* storage.read<unknown>(k)
          }),
        )
        return sanitizeRun(raw)
      } catch {
        return undefined
      }
    }),
  )
  return records
    .filter((r): r is LoopRun => r !== undefined)
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, limit)
}
