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
import {
  HISTORY_LIMIT,
  LoopMetaSchema,
  generateID,
  sanitizeDefinition,
  sanitizeRun,
  type LoopDefinition,
  type LoopMeta,
  type LoopRun,
} from "./schema"

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

function metaKey(loopID: string): string[] {
  return ["loop_meta", Instance.project.id, loopID]
}

/**
 * List a prefix and read every record in a single Effect program (one layer
 * build for the whole batch instead of one per record). Unreadable records
 * resolve to `undefined`.
 */
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

async function readRunsByPrefix(prefix: string[]): Promise<LoopRun[]> {
  const records = await readAllByPrefix(prefix)
  return records.map(sanitizeRun).filter((r): r is LoopRun => r !== undefined)
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

export async function list(): Promise<LoopDefinition[]> {
  const records = await readAllByPrefix(defListPrefix())
  return records
    .map(sanitizeDefinition)
    .filter((r): r is LoopDefinition => r !== undefined)
    .sort((a, b) => b.createdAt - a.createdAt)
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
  // Cascade: drop every run record + the meta counter so we don't leak orphan entries.
  await runStorage(
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      const runKeys = yield* storage.list(runListPrefix(id))
      yield* Effect.forEach(
        [...runKeys, metaKey(id)],
        (key) => storage.remove(key).pipe(Effect.catch(() => Effect.succeed(undefined))),
        { concurrency: 10 },
      )
    }),
  ).catch(() => {})
  return true
}

export async function setEnabled(id: string, enabled: boolean): Promise<LoopDefinition | undefined> {
  const def = await get(id)
  if (!def) return undefined
  const next: LoopDefinition = { ...def, enabled }
  return upsert(next)
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
    return await runStorage(
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        return yield* storage.update<LoopRun>(runKey(loopID, runID), (draft) => {
          if (draft.status === "running") {
            draft.status = "orphaned"
            draft.ok = false
            draft.endedAt = endedAt
            draft.error = draft.error ?? "Process exited before the run finished"
          }
        })
      }),
    )
  } catch (error) {
    log.warn("orphanRun failed", { loopID, runID, error })
    return undefined
  }
}

/** Find every run across every loop that is still in `"running"` status. */
export async function listRunningRuns(): Promise<LoopRun[]> {
  const records = await readRunsByPrefix(runListAllPrefix())
  return records.filter((r) => r.status === "running")
}

// ── Run counter (meta record) ─────────────────────────────────────────────────

async function readMeta(loopID: string): Promise<LoopMeta | undefined> {
  try {
    const raw = await runStorage(
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        return yield* storage.read<unknown>(metaKey(loopID))
      }),
    )
    const parsed = LoopMetaSchema.safeParse(raw)
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

async function writeMeta(loopID: string, meta: LoopMeta): Promise<void> {
  await runStorage(
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      yield* storage.write(metaKey(loopID), meta)
    }),
  )
}

/**
 * Lifetime number of started runs. Backed by the meta counter, not the run
 * history (which `trimRuns` caps at HISTORY_LIMIT), so `maxRuns` larger than
 * the history window still triggers. Missing counters are initialized from
 * the surviving history records (one-time migration for pre-counter loops).
 */
export async function countRuns(loopID: string): Promise<number> {
  const meta = await readMeta(loopID)
  if (meta) return meta.startedRuns
  const runs = await readRunsByPrefix(runListPrefix(loopID))
  await writeMeta(loopID, { startedRuns: runs.length }).catch(() => {})
  return runs.length
}

/** Overwrite the lifetime run counter. Used after manual run cap edits. */
export async function resetRunCounter(loopID: string, startedRuns = 0): Promise<void> {
  try {
    await writeMeta(loopID, { startedRuns })
  } catch (error) {
    log.warn("resetRunCounter failed", { loopID, error })
  }
}

// ── Runs ──────────────────────────────────────────────────────────────────────

export async function startRun(loopID: string, sessionID?: string): Promise<LoopRun> {
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
  await runStorage(
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      yield* storage.write(runKey(loopID, run.id), run)
    }),
  )
  // Bump the lifetime counter; on first contact derive it from history (the
  // record above is already included in that count).
  try {
    const meta = await readMeta(loopID)
    if (meta) await writeMeta(loopID, { startedRuns: meta.startedRuns + 1 })
    else await writeMeta(loopID, { startedRuns: (await readRunsByPrefix(runListPrefix(loopID))).length })
  } catch (error) {
    log.warn("run counter bump failed", { loopID, error })
  }
  return run
}

/** Renew the lease on a running run. No-op if the run already finished. */
export async function touchRun(loopID: string, runID: string): Promise<void> {
  try {
    await runStorage(
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        yield* storage.update<LoopRun>(runKey(loopID, runID), (draft) => {
          if (draft.status !== "running") return
          draft.heartbeatAt = Date.now()
        })
      }),
    )
  } catch (error) {
    log.warn("touchRun failed", { loopID, runID, error })
  }
}

/** Attach the session to a running run without touching status/endedAt. */
export async function attachRunSession(loopID: string, runID: string, sessionID: string): Promise<void> {
  try {
    await runStorage(
      Effect.gen(function* () {
        const storage = yield* Storage.Service
        yield* storage.update<LoopRun>(runKey(loopID, runID), (draft) => {
          draft.sessionID = sessionID
        })
      }),
    )
  } catch (error) {
    log.warn("attachRunSession failed", { loopID, runID, error })
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
  // Drop oldest (filenames end with `${runID}.json`; the trailing .json is stripped
  // by listImpl, so the last segment is the runID). Single Effect program: the
  // cheap key-count check, the reads, and the removals share one layer build.
  await runStorage(
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      const keys = yield* storage.list(runListPrefix(loopID))
      if (keys.length <= HISTORY_LIMIT) return
      const records = yield* Effect.forEach(
        keys,
        (k) =>
          storage.read<unknown>(k).pipe(
            Effect.map(sanitizeRun),
            Effect.catch(() => Effect.succeed(undefined)),
          ),
        { concurrency: 10 },
      )
      const sortable = records.filter((r): r is LoopRun => r !== undefined)
      sortable.sort((a, b) => a.startedAt - b.startedAt)
      const toDrop = sortable.slice(0, sortable.length - HISTORY_LIMIT)
      yield* Effect.forEach(
        toDrop,
        (r) => storage.remove(runKey(loopID, r.id)).pipe(Effect.catch(() => Effect.succeed(undefined))),
        { concurrency: 10 },
      )
    }),
  ).catch(() => {})
}

export async function listRuns(loopID: string, limit = HISTORY_LIMIT): Promise<LoopRun[]> {
  const records = await readRunsByPrefix(runListPrefix(loopID))
  return records.sort((a, b) => b.startedAt - a.startedAt).slice(0, limit)
}

export async function listAllRunsAcrossLoops(limit = 100): Promise<LoopRun[]> {
  const records = await readRunsByPrefix(runListAllPrefix())
  return records.sort((a, b) => b.startedAt - a.startedAt).slice(0, limit)
}
