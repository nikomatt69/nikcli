import { and, eq, inArray } from "drizzle-orm"
import { Database } from "@/database/database"
import { syncSequence } from "@/sync/sync.sql"
import { instructionBlob, instructionState } from "./instruction.sql"

export namespace InstructionRepo {
  type Executor = Database.TxOrDb

  function db() {
    return Database.syncDb()
  }

  export type Fold = {
    values: Record<string, string>
    order: string[]
    epoch_values: Record<string, string>
    epoch_order: string[]
  }

  export type State = {
    sessionID: string
    epochSeq: number
    updatedSeq: number
    parentSessionID?: string
    parentSeq?: number
    data: Fold
  }

  function parseFold(raw: string): Fold | undefined {
    try {
      const parsed = JSON.parse(raw) as Fold
      if (!parsed || typeof parsed !== "object") return undefined
      if (!parsed.values || typeof parsed.values !== "object") return undefined
      if (!Array.isArray(parsed.order)) return undefined
      if (!parsed.epoch_values || typeof parsed.epoch_values !== "object") return undefined
      if (!Array.isArray(parsed.epoch_order)) return undefined
      return parsed
    } catch {
      return undefined
    }
  }

  export function get(sessionID: string, tx: Executor = db()): State | undefined {
    const row = tx.select().from(instructionState).where(eq(instructionState.sessionId, sessionID)).get()
    if (!row) return undefined
    const data = parseFold(row.data)
    if (!data) return undefined
    return {
      sessionID: row.sessionId,
      epochSeq: row.epochSeq,
      updatedSeq: row.updatedSeq,
      parentSessionID: row.parentSessionId ?? undefined,
      parentSeq: row.parentSeq ?? undefined,
      data,
    }
  }

  export function put(state: State, tx: Executor = db()): void {
    tx.insert(instructionState)
      .values({
        sessionId: state.sessionID,
        epochSeq: state.epochSeq,
        updatedSeq: state.updatedSeq,
        parentSessionId: state.parentSessionID ?? null,
        parentSeq: state.parentSeq ?? null,
        data: JSON.stringify(state.data),
      })
      .onConflictDoUpdate({
        target: instructionState.sessionId,
        set: {
          epochSeq: state.epochSeq,
          updatedSeq: state.updatedSeq,
          parentSessionId: state.parentSessionID ?? null,
          parentSeq: state.parentSeq ?? null,
          data: JSON.stringify(state.data),
        },
      })
      .run()
  }

  export function removeSession(sessionID: string, tx: Executor = db()): boolean {
    const result = tx.delete(instructionState).where(eq(instructionState.sessionId, sessionID)).run()
    return (result as unknown as { changes: number }).changes > 0
  }

  export function putBlobs(blobs: Array<{ hash: string; body: string }>, tx: Executor = db()): void {
    if (blobs.length === 0) return
    const unique = new Map<string, string>()
    for (const blob of blobs) unique.set(blob.hash, blob.body)
    tx.insert(instructionBlob)
      .values([...unique.entries()].map(([hash, body]) => ({ hash, body })))
      .onConflictDoNothing()
      .run()
  }

  export function getBlobs(hashes: string[], tx: Executor = db()): Record<string, string> {
    if (hashes.length === 0) return {}
    const rows = tx
      .select()
      .from(instructionBlob)
      .where(inArray(instructionBlob.hash, hashes))
      .all()
    const out: Record<string, string> = {}
    for (const row of rows) out[row.hash] = row.body
    return out
  }

  export function getBlob(hash: string, tx: Executor = db()): string | undefined {
    const row = tx.select().from(instructionBlob).where(eq(instructionBlob.hash, hash)).get()
    return row?.body
  }

  export function applyDelta(
    tx: Executor,
    input: {
      sessionID: string
      delta: Record<string, string>
      seq: number
    },
  ): State {
    const current = get(input.sessionID, tx)
    const values = { ...(current?.data.values ?? {}) }
    const order = current?.data.order ? [...current.data.order] : []

    for (const [key, value] of Object.entries(input.delta)) {
      if (value === "removed") {
        delete values[key]
        const index = order.indexOf(key)
        if (index >= 0) order.splice(index, 1)
        continue
      }
      if (!(key in (current?.data.values ?? {}))) order.push(key)
      values[key] = value
    }

    const initial = !current
    const data: Fold = initial
      ? { values, order, epoch_values: { ...values }, epoch_order: [...order] }
      : {
          values,
          order,
          epoch_values: current.data.epoch_values,
          epoch_order: current.data.epoch_order,
        }

    const next: State = {
      sessionID: input.sessionID,
      epochSeq: initial ? input.seq : current.epochSeq,
      updatedSeq: input.seq,
      parentSessionID: current?.parentSessionID,
      parentSeq: current?.parentSeq,
      data,
    }
    put(next, tx)
    return next
  }

  export function inherit(parentID: string, childID: string, tx: Executor = db()): State | undefined {
    const parent = get(parentID, tx)
    if (!parent) return undefined
    const child: State = {
      sessionID: childID,
      epochSeq: 0,
      updatedSeq: 0,
      parentSessionID: parentID,
      parentSeq: parent.updatedSeq,
      data: {
        values: { ...parent.data.values },
        order: [...parent.data.order],
        epoch_values: { ...parent.data.values },
        epoch_order: [...parent.data.order],
      },
    }
    put(child, tx)
    return child
  }

  export function advanceEpoch(sessionID: string, seq: number, tx: Executor = db()): State | undefined {
    const current = get(sessionID, tx)
    if (!current) return undefined
    const next: State = {
      ...current,
      epochSeq: seq,
      data: {
        ...current.data,
        epoch_values: { ...current.data.values },
        epoch_order: [...current.data.order],
      },
    }
    put(next, tx)
    return next
  }

  export function latestAggregateSeq(projectID: string, sessionID: string, tx: Executor = db()): number {
    const row = tx
      .select({ seq: syncSequence.seq })
      .from(syncSequence)
      .where(and(eq(syncSequence.projectId, projectID), eq(syncSequence.aggregate, sessionID)))
      .get()
    return row?.seq ?? 0
  }
}
