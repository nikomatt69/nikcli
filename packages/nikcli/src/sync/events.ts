/**
 * Sync event taxonomy — typed application events emitted via `Sync.emitRaw`.
 *
 * `Sync.emitRaw` accepts an `unknown` payload, which is right for the
 * pass-through restore events (workspace/session bus replay), but too
 * shallow for the small set of events that drive cold-start projection,
 * remote sync bookkeeping, and one-shot migrations. This Module owns that
 * set: every event has a registered type literal, a Zod schema for its
 * payload, and an inferred TypeScript shape.
 *
 * Public surface (under `SyncEvents` namespace):
 *   - `define(...)` — register an event (literal + schema + aggregate kind)
 *   - `emit(projectID, aggregate, def, payload)` — typed emit
 *   - `ofType(def)` — predicate for replay/reducer filtering
 *   - `E.Workspace.created`, `E.Workspace.removed`, ... — the catalog
 *   - `all` — every registered application event
 *
 * Migration: `Sync.emitRaw` callers that already pass a typed shape
 * (e.g. `workspace/projection.ts`) keep their path; this Module simply
 * gives them a registered contract.
 */
import { z } from "zod"
import { Log } from "@/util/log"
import { Sync, type SyncEventRecord } from "./index"

const log = Log.create({ service: "sync-events" })

export type EventDef<T extends z.ZodTypeAny> = {
  readonly type: string
  readonly schema: T
  /** Aggregate kind the event targets. Used as a sanity check on emit. */
  readonly aggregate: "workspace" | "session" | "project" | "global"
}

function define<T extends z.ZodTypeAny>(type: string, schema: T, aggregate: EventDef<T>["aggregate"]): EventDef<T> {
  return Object.freeze({ type, schema, aggregate })
}

function emit<T extends z.ZodTypeAny>(
  projectID: string,
  aggregate: string,
  def: EventDef<T>,
  payload: z.infer<T>,
  options: { workspaceID?: string; origin?: string; originSeq?: number } = {},
): Promise<SyncEventRecord> {
  const parsed = def.schema.safeParse(payload)
  if (!parsed.success) {
    log.warn("sync event payload failed schema", {
      type: def.type,
      issues: parsed.error.issues,
    })
    return Sync.emitRaw(projectID, aggregate, { type: def.type, payload, _schemaError: parsed.error.message }, options)
  }
  return Sync.emitRaw(projectID, aggregate, { type: def.type, ...(parsed.data as Record<string, unknown>) }, options)
}

function ofType<T extends z.ZodTypeAny>(def: EventDef<T>): (event: { type?: string }) => boolean {
  return (event) => event?.type === def.type
}

const WorkspaceBasePayload = z.object({
  config: z.unknown().optional(),
  branch: z.string().nullable().optional(),
  name: z.string().optional(),
  timeUsed: z.number().optional(),
})

const E = {
  Workspace: {
    created: define("workspace.created", WorkspaceBasePayload, "workspace"),
    removed: define("workspace.removed", z.object({}).strict(), "workspace"),
    configUpdated: define(
      "workspace.configUpdated",
      z.object({
        config: z.unknown(),
        branch: z.string().nullable().optional(),
      }),
      "workspace",
    ),
    statusChanged: define("workspace.statusChanged", z.object({ status: z.string() }), "workspace"),
  },
  SyncUnify: {
    migrated: define(
      "sync_unify.workspace_migrated",
      z.object({
        seeded: z.number().int().nonnegative(),
        at: z.number().int(),
        projectID: z.string().nullable().optional(),
      }),
      "global",
    ),
  },
} as const

export type AppEventDef = EventDef<z.ZodTypeAny>

const all: ReadonlyArray<AppEventDef> = [
  E.Workspace.created,
  E.Workspace.removed,
  E.Workspace.configUpdated,
  E.Workspace.statusChanged,
  E.SyncUnify.migrated,
]

export const SyncEvents = {
  define,
  emit,
  ofType,
  E,
  all,
} as const
