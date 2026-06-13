/**
 * Missions — TUI plugin: SDK wrapper around the server's `/mission` routes.
 *
 * The TUI keeps a reactive store (`runner.ts`) for fast UI updates, but the
 * source of truth for definitions, execution history, and orchestration is
 * the server's `MissionOrchestrator`. The plugin subscribes to the bus events
 * published by the orchestrator so live state stays in sync even when the
 * headless engine starts/stops a mission while the TUI is open.
 *
 * The shape returned by the server (the persisted `MissionDefinitionSchema`)
 * is what we mirror here; the server's runtime map is `{ missionID, runtime }`
 * where `runtime` carries the live status fields.
 */

import type { NikcliClient } from "@nikcli-ai/sdk/v2";
import type { TuiEventBus } from "@nikcli-ai/plugin/tui";
import {
  type MissionDefinition,
  type MissionExec,
  type MissionFeature,
  type MissionMilestone,
  type MissionModels,
  type MissionStatus,
  progressOf,
} from "./store";

export type {
  MissionDefinition,
  MissionExec,
  MissionFeature,
  MissionMilestone,
  MissionModels,
  MissionStatus,
} from "./store";

export type MissionTemplate = {
  id: string;
  title: string;
  description: string;
  brief: string;
};

export type MissionRuntimeStatus =
  | "idle"
  | "running"
  | "paused"
  | "error"
  | "cancelling";

export type MissionRuntime = {
  status: MissionRuntimeStatus;
  sessionID?: string;
  currentMilestoneID?: string;
  currentFeatureID?: string;
  doneFeatures: number;
  totalFeatures: number;
  lastError?: string;
  lastRunAt?: number;
};

export type ListResult = {
  missions: MissionDefinition[];
  runtimes: Array<{ missionID: string; runtime: MissionRuntime }>;
};

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRuntime(value: unknown): MissionRuntime {
  const r = (value ?? {}) as Record<string, unknown>;
  const statusRaw = asString(r.status, "idle");
  const status: MissionRuntimeStatus =
    statusRaw === "running" ||
    statusRaw === "paused" ||
    statusRaw === "error" ||
    statusRaw === "cancelling"
      ? statusRaw
      : "idle";
  return {
    status,
    ...(typeof r.sessionID === "string" ? { sessionID: r.sessionID } : {}),
    ...(typeof r.currentMilestoneID === "string"
      ? { currentMilestoneID: r.currentMilestoneID }
      : {}),
    ...(typeof r.currentFeatureID === "string"
      ? { currentFeatureID: r.currentFeatureID }
      : {}),
    doneFeatures: asNumber(r.doneFeatures, 0),
    totalFeatures: asNumber(r.totalFeatures, 0),
    ...(typeof r.lastError === "string" ? { lastError: r.lastError } : {}),
    ...(typeof r.lastRunAt === "number" ? { lastRunAt: r.lastRunAt } : {}),
  };
}

const FEATURE_STATUSES = new Set([
  "pending",
  "running",
  "done",
  "blocked",
  "skipped",
  "error",
]);
const MILESTONE_STATUSES = new Set([
  "pending",
  "running",
  "validating",
  "done",
  "blocked",
]);
const VALIDATION_POLICIES = new Set(["scrutiny", "user-test", "none"]);
const MISSION_STATUSES = new Set([
  "planning",
  "ready",
  "running",
  "paused",
  "frozen",
  "complete",
  "error",
]);

function asFeature(value: unknown): MissionFeature | undefined {
  if (!isPlainObject(value)) return undefined;
  const objective = asString(value.objective).trim();
  if (!objective) return undefined;
  const id = asString(value.id);
  const name = asString(value.name).trim() || objective.slice(0, 48);
  const agent = asString(value.agent).trim() || "ralph";
  const statusRaw = asString(value.status, "pending");
  const status = (
    FEATURE_STATUSES.has(statusRaw) ? statusRaw : "pending"
  ) as MissionFeature["status"];
  const dependsOn = Array.isArray(value.dependsOn)
    ? value.dependsOn.filter((d): d is string => typeof d === "string")
    : [];
  const f: MissionFeature = {
    id: id || `f_${objective.length}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    objective,
    agent,
    status,
    dependsOn,
    ...(typeof value.model === "string" ? { model: value.model } : {}),
    ...(typeof value.tokenBudget === "number" && value.tokenBudget > 0
      ? { tokenBudget: Math.floor(value.tokenBudget) }
      : {}),
    ...(typeof value.error === "string" ? { error: value.error } : {}),
  };
  return f;
}

function asMilestone(value: unknown): MissionMilestone | undefined {
  if (!isPlainObject(value)) return undefined;
  const featuresRaw = Array.isArray(value.features) ? value.features : [];
  const features = featuresRaw
    .map(asFeature)
    .filter((f): f is MissionFeature => f !== undefined);
  if (features.length === 0) return undefined;
  const id = asString(value.id);
  const name = asString(value.name).trim() || "Milestone";
  const validationRaw = asString(value.validation, "scrutiny");
  const validation = (
    VALIDATION_POLICIES.has(validationRaw) ? validationRaw : "scrutiny"
  ) as MissionMilestone["validation"];
  const statusRaw = asString(value.status, "pending");
  const status = (
    MILESTONE_STATUSES.has(statusRaw) ? statusRaw : "pending"
  ) as MissionMilestone["status"];
  return { id, name, features, validation, status };
}

function asModels(value: unknown): MissionModels {
  if (!isPlainObject(value)) return {};
  const out: MissionModels = {};
  if (typeof value.worker === "string") out.worker = value.worker;
  if (typeof value.validation === "string") out.validation = value.validation;
  if (typeof value.orchestrator === "string")
    out.orchestrator = value.orchestrator;
  return out;
}

function asDefinition(value: unknown): MissionDefinition | undefined {
  if (!isPlainObject(value)) return undefined;
  const id = asString(value.id);
  const name = asString(value.name);
  const brief = asString(value.brief);
  if (!id || !name || !brief.trim()) return undefined;
  const milestonesRaw = Array.isArray(value.milestones) ? value.milestones : [];
  const milestones = milestonesRaw
    .map(asMilestone)
    .filter((m): m is MissionMilestone => m !== undefined);
  if (milestones.length === 0) return undefined;
  const statusRaw = asString(value.status, "ready");
  const status = (
    MISSION_STATUSES.has(statusRaw) ? statusRaw : "ready"
  ) as MissionStatus;
  const out: MissionDefinition = {
    id,
    name,
    brief,
    milestones,
    models: asModels(value.models),
    status,
    createdAt: asNumber(value.createdAt, Date.now()),
  };
  if (typeof value.timeoutMs === "number" && value.timeoutMs > 0)
    out.timeoutMs = Math.floor(value.timeoutMs);
  return out;
}

function asExec(value: unknown): MissionExec | undefined {
  if (!isPlainObject(value)) return undefined;
  const id = asString(value.id);
  if (!id) return undefined;
  const kindRaw = asString(value.kind);
  if (kindRaw !== "feature" && kindRaw !== "validation") return undefined;
  const startedAt = asNumber(value.startedAt, 0);
  if (startedAt === 0) return undefined;
  return {
    execID: id,
    kind: kindRaw,
    targetID: asString(value.targetID),
    targetName: asString(value.targetName),
    startedAt,
    ...(typeof value.endedAt === "number" ? { endedAt: value.endedAt } : {}),
    status: asString(value.status, "running") as MissionExec["status"],
    ok: value.ok === true,
    ...(typeof value.error === "string" ? { error: value.error } : {}),
    ...(typeof value.sessionID === "string"
      ? { sessionID: value.sessionID }
      : {}),
  };
}

function asTemplate(value: unknown): MissionTemplate | undefined {
  if (!isPlainObject(value)) return undefined;
  const id = asString(value.id);
  const title = asString(value.title);
  if (!id || !title) return undefined;
  return {
    id,
    title,
    description: asString(value.description),
    brief: asString(value.brief),
  };
}

export type GeneratedDraft = {
  name?: string;
  brief: string;
  milestones: Array<{
    name?: string;
    validation?: "scrutiny" | "user-test" | "none";
    features: Array<{
      name?: string;
      agent?: string;
      model?: string;
      objective: string;
      tokenBudget?: number;
      dependsOn?: string[];
    }>;
  }>;
  models?: MissionModels;
};

/**
 * Thin wrapper around the SDK. Methods are best-effort: a server outage
 * returns undefined/empty arrays so the UI can fall back to the local KV
 * cache instead of crashing.
 */
type MissionSdk = NikcliClient & {
  mission?: Record<
    string,
    ((input: Record<string, unknown>) => Promise<{ data: unknown }>) | undefined
  >;
};

/**
 * Thin wrapper around the SDK. Methods are best-effort: a server outage
 * returns undefined/empty arrays so the UI can fall back to the local KV
 * cache instead of crashing.
 */
export class MissionApi {
  private readonly sdk: MissionSdk;
  constructor(client: NikcliClient) {
    this.sdk = client as unknown as MissionSdk;
  }

  private async call<T>(
    endpoint: string,
    input: Record<string, unknown>,
  ): Promise<T | undefined> {
    const fn = (
      this.sdk.mission as
        | Record<
            string,
            | ((input: Record<string, unknown>) => Promise<{ data: unknown }>)
            | undefined
          >
        | undefined
    )?.[endpoint];
    if (!fn) return undefined;
    try {
      const res = await fn(input);
      return (res.data as T) ?? undefined;
    } catch {
      return undefined;
    }
  }

  async list(): Promise<ListResult> {
    const data = await this.call<unknown>("list", {});
    if (!isPlainObject(data)) return { missions: [], runtimes: [] };
    const missions = Array.isArray(data.missions)
      ? data.missions
          .map(asDefinition)
          .filter((d): d is MissionDefinition => d !== undefined)
      : [];
    const runtimes = Array.isArray(data.runtimes)
      ? data.runtimes
          .map((r) => {
            if (!isPlainObject(r)) return undefined;
            const id = asString(r.missionID);
            if (!id) return undefined;
            return { missionID: id, runtime: asRuntime(r.runtime) };
          })
          .filter(
            (r): r is { missionID: string; runtime: MissionRuntime } =>
              r !== undefined,
          )
      : [];
    return { missions, runtimes };
  }

  async get(
    id: string,
  ): Promise<
    { mission: MissionDefinition; runtime: MissionRuntime } | undefined
  > {
    const data = await this.call<unknown>("get", { id });
    if (!isPlainObject(data)) return undefined;
    const mission = asDefinition(data.mission);
    if (!mission) return undefined;
    return { mission, runtime: asRuntime(data.runtime) };
  }

  async upsert(def: MissionDefinition): Promise<MissionDefinition | undefined> {
    const data = await this.call<unknown>("upsert", {
      ...serializeDefinition(def),
    });
    return data ? asDefinition(data) : undefined;
  }

  async update(def: MissionDefinition): Promise<MissionDefinition | undefined> {
    const data = await this.call<unknown>("update", {
      id: def.id,
      ...serializeDefinition(def),
    });
    return data ? asDefinition(data) : undefined;
  }

  async remove(id: string): Promise<boolean> {
    const data = await this.call<unknown>("delete", { id });
    return data === true || data === undefined;
  }

  async start(id: string): Promise<boolean> {
    const data = await this.call<unknown>("start", { id });
    return data === true;
  }

  async pause(id: string): Promise<boolean> {
    const data = await this.call<unknown>("pause", { id });
    return data === true;
  }

  async cancel(id: string): Promise<boolean> {
    const data = await this.call<unknown>("cancel", { id });
    return data === true;
  }

  async mutateFeature(
    id: string,
    featureID: string,
    patch: {
      status?: MissionFeature["status"];
      error?: string;
      appendDependsOn?: string[];
    },
  ): Promise<MissionDefinition | undefined> {
    const data = await this.call<unknown>("feature.mutate", {
      id,
      featureID,
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.error !== undefined ? { error: patch.error } : {}),
      ...(patch.appendDependsOn
        ? { appendDependsOn: patch.appendDependsOn }
        : {}),
    });
    return data ? asDefinition(data) : undefined;
  }

  async execs(id: string, limit = 100): Promise<MissionExec[]> {
    const data = await this.call<unknown>("execs", { id, limit });
    if (!isPlainObject(data)) return [];
    return Array.isArray(data.execs)
      ? data.execs.map(asExec).filter((e): e is MissionExec => e !== undefined)
      : [];
  }

  async templates(): Promise<MissionTemplate[]> {
    const data = await this.call<unknown>("templates", {});
    if (!isPlainObject(data)) return [];
    return Array.isArray(data.templates)
      ? data.templates
          .map(asTemplate)
          .filter((t): t is MissionTemplate => t !== undefined)
      : [];
  }

  async generateFromDescription(
    description: string,
    opts: { model?: string; agent?: string } = {},
  ): Promise<MissionDefinition | undefined> {
    const data = await this.call<unknown>("generate", { description, ...opts });
    return data ? asDefinition(data) : undefined;
  }
}

function serializeDefinition(def: MissionDefinition): Record<string, unknown> {
  return {
    id: def.id,
    name: def.name,
    brief: def.brief,
    milestones: def.milestones.map((m) => ({
      id: m.id,
      name: m.name,
      validation: m.validation,
      status: m.status,
      features: m.features.map((f) => ({
        id: f.id,
        name: f.name,
        objective: f.objective,
        agent: f.agent,
        ...(f.model ? { model: f.model } : {}),
        ...(f.tokenBudget ? { tokenBudget: f.tokenBudget } : {}),
        dependsOn: f.dependsOn,
        status: f.status,
        ...(f.error ? { error: f.error } : {}),
      })),
    })),
    models: def.models,
    ...(def.timeoutMs ? { timeoutMs: def.timeoutMs } : {}),
    status: def.status,
    createdAt: def.createdAt,
  };
}

// ── Bus subscription helper ──────────────────────────────────────────────────

/**
 * Subscribe to mission bus events so the TUI can react to orchestration that
 * starts/finishes via the headless engine. Returns the unsubscribe function.
 */
export function subscribeMissionEvents(
  bus: TuiEventBus,
  handlers: {
    onUpserted?: (missionID: string) => void;
    onRemoved?: (missionID: string) => void;
    onStarted?: (missionID: string) => void;
    onFinished?: (missionID: string, status: string, error?: string) => void;
    onExecStarted?: (
      missionID: string,
      execID: string,
      kind: "feature" | "validation",
      targetID: string,
      sessionID: string,
    ) => void;
    onExecFinished?: (
      missionID: string,
      execID: string,
      kind: "feature" | "validation",
      status: string,
      ok: boolean,
      error?: string,
    ) => void;
    onRuntimeChanged?: (missionID: string) => void;
  },
): () => void {
  const offs: Array<() => void> = [];
  if (handlers.onUpserted)
    offs.push(
      bus.on("mission.upserted", (e) =>
        handlers.onUpserted?.(e.properties.missionID),
      ),
    );
  if (handlers.onRemoved)
    offs.push(
      bus.on("mission.removed", (e) =>
        handlers.onRemoved?.(e.properties.missionID),
      ),
    );
  if (handlers.onStarted)
    offs.push(
      bus.on("mission.started", (e) =>
        handlers.onStarted?.(e.properties.missionID),
      ),
    );
  if (handlers.onFinished)
    offs.push(
      bus.on("mission.finished", (e) =>
        handlers.onFinished?.(
          e.properties.missionID,
          e.properties.status,
          e.properties.error,
        ),
      ),
    );
  if (handlers.onExecStarted)
    offs.push(
      bus.on("mission.exec.started", (e) =>
        handlers.onExecStarted?.(
          e.properties.missionID,
          e.properties.execID,
          e.properties.kind,
          e.properties.targetID,
          e.properties.sessionID,
        ),
      ),
    );
  if (handlers.onExecFinished)
    offs.push(
      bus.on("mission.exec.finished", (e) =>
        handlers.onExecFinished?.(
          e.properties.missionID,
          e.properties.execID,
          e.properties.kind,
          e.properties.status,
          e.properties.ok,
          e.properties.error,
        ),
      ),
    );
  if (handlers.onRuntimeChanged)
    offs.push(
      bus.on("mission.runtime.changed", (e) =>
        handlers.onRuntimeChanged?.(e.properties.missionID),
      ),
    );
  return () => {
    for (const off of offs) off();
  };
}

// Suppress unused-import lint for the helper re-export.
void progressOf;
