/**
 * DeepSec — SDK helpers for the TUI plugin.
 *
 * DeepSec (https://github.com/vercel-labs/deepsec) is an agent-powered
 * vulnerability scanner whose workflow (`init → scan → process → export`) maps
 * cleanly onto the loop engine's stage pipeline. Rather than reimplement an
 * orchestrator, this plugin authors a `LoopDefinition` from the canonical
 * DeepSec stages and drives it through the existing `LoopApi` so resume,
 * history, PR creation, and scheduling all come for free.
 *
 * The stage objectives live in `@/loop/schema` (`DEEPSEC_STAGES`) so the
 * `/deepsec` command and the `/loops` wizard build the exact same pipeline.
 */
import type { NikcliClient } from "@nikcli-ai/sdk/v2"
import { DEEPSEC_STAGES, definitionFromGenerated, type LoopDefinition, type LoopStage } from "@/loop/schema"
import { LoopApi, type LoopRuntime } from "../loops/sdk"

export type { LoopDefinition, LoopRuntime } from "../loops/sdk"

/** Which DeepSec pipeline to run. */
export type DeepSecMode = "full" | "diff" | "export"

export type DeepSecPlan = {
  mode: DeepSecMode
  /** Stable loop name; reused so repeated invocations don't pile up loops. */
  name: string
  stages: LoopStage[]
  /** Recurring scans set an interval; one-shot scans stay manual. */
  intervalMs?: number
}

const NAME = {
  full: "DeepSec security scan",
  diff: "DeepSec PR diff scan",
  export: "DeepSec report",
  scheduled: "DeepSec scheduled scan",
} as const

/** Human label + short blurb for each mode, surfaced in the launcher dialog. */
export const DEEPSEC_MODES: ReadonlyArray<{ mode: DeepSecMode; title: string; description: string }> = [
  {
    mode: "full",
    title: "Run full scan",
    description: "init → scan → process → export over the whole repo (can be slow/expensive)",
  },
  {
    mode: "diff",
    title: "Scan PR diff",
    description: "Investigate only the changes on the current branch (fast change-validation pass)",
  },
  {
    mode: "export",
    title: "Export report",
    description: "Re-export the findings from the last run as markdown + JSON",
  },
]

function stagesFor(mode: DeepSecMode): LoopStage[] {
  switch (mode) {
    case "full":
      return [DEEPSEC_STAGES.bootstrap, DEEPSEC_STAGES.scan, DEEPSEC_STAGES.process, DEEPSEC_STAGES.export]
    case "diff":
      return [DEEPSEC_STAGES.bootstrap, DEEPSEC_STAGES.diff, DEEPSEC_STAGES.export]
    case "export":
      return [DEEPSEC_STAGES.export]
  }
}

/**
 * Build the run plan for a mode. `intervalMs` turns the full scan into a
 * recurring (scheduled) loop; otherwise the loop is manual and we trigger it
 * once. Recurring scans use a distinct name so they coexist with one-shots.
 */
export function planFor(mode: DeepSecMode, opts: { intervalMs?: number } = {}): DeepSecPlan {
  const stages = stagesFor(mode)
  const name = opts.intervalMs !== undefined && mode === "full" ? NAME.scheduled : NAME[mode]
  return {
    mode,
    name,
    stages,
    ...(opts.intervalMs !== undefined ? { intervalMs: opts.intervalMs } : {}),
  }
}

/** Turn a plan into a validated LoopDefinition (id assigned on persist). */
export function definitionFor(plan: DeepSecPlan): LoopDefinition {
  return definitionFromGenerated({
    name: plan.name,
    stages: plan.stages,
    ...(plan.intervalMs !== undefined ? { intervalMs: plan.intervalMs } : {}),
  })
}

export class DeepSecApi {
  private loops: LoopApi
  constructor(client: NikcliClient) {
    this.loops = new LoopApi(client)
  }

  /** Loops authored by this plugin (matched by their well-known names). */
  async list(): Promise<Array<{ def: LoopDefinition; runtime: LoopRuntime }>> {
    const known = new Set<string>(Object.values(NAME))
    const { loops, runtimes } = await this.loops.list().catch(() => ({ loops: [], runtimes: [] }))
    const rt = new Map(runtimes.map((r) => [r.loopID, r.runtime]))
    return loops
      .filter((d) => known.has(d.name))
      .map((def) => ({ def, runtime: rt.get(def.id) ?? { status: "idle" as const, runs: 0 } }))
  }

  /**
   * Find the existing loop for a plan (by name) or create it, reconciling its
   * stages/trigger with the latest plan so wording fixes propagate. Returns the
   * persisted definition (with a server-assigned id).
   */
  async ensure(plan: DeepSecPlan): Promise<LoopDefinition> {
    const def = definitionFor(plan)
    const { loops } = await this.loops.list().catch(() => ({ loops: [] as LoopDefinition[] }))
    const existing = loops.find((d) => d.name === plan.name)
    if (existing) {
      const next: LoopDefinition = {
        ...existing,
        stages: def.stages,
        trigger: def.trigger,
        enabled: true,
      }
      return this.loops.update(next)
    }
    return this.loops.upsert(def)
  }

  /** Ensure the loop exists, then trigger one run immediately. */
  async runNow(plan: DeepSecPlan): Promise<LoopDefinition> {
    const def = await this.ensure(plan)
    await this.loops.run(def.id)
    return def
  }

  /** Persist a recurring scan; the server scheduler fires it on its interval. */
  async schedule(intervalMs: number): Promise<LoopDefinition> {
    return this.ensure(planFor("full", { intervalMs }))
  }

  /** Trigger one run of an already-persisted loop by id. */
  async run(id: string): Promise<boolean> {
    return this.loops.run(id)
  }

  async remove(id: string): Promise<boolean> {
    return this.loops.remove(id)
  }
}
