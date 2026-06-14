/**
 * Missions — public surface.
 *
 * A Mission is a high-altitude workflow that decomposes a goal into
 * **milestones**, each holding a DAG of **features**, with a **validation**
 * checkpoint at the end of each milestone. The orchestrator drives one feature
 * at a time through the same `goal` worker the Loop engine uses, then runs a
 * validation worker before advancing the milestone.
 *
 * - `schema.ts`  — persisted types (MissionDefinition, Milestone, Feature,
 *                  Validation policy, Execution record) + pure helpers.
 * - `manager.ts` — CRUD + execution-record persistence, mirroring
 *                  `src/loop/manager.ts`.
 * - `orchestrator.ts` — the headless engine that walks a Mission to
 *                  completion, with single-flight, lease/heartbeat, orphan
 *                  recovery, and Bus events.
 */

export * from "./schema"
export * as Manager from "./manager"
export * as Orchestrator from "./orchestrator"
