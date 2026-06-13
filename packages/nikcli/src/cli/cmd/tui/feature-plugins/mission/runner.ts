/**
 * Missions — TUI plugin: runtime engine (reactive store + server sync).
 *
 * The plugin keeps a Solid store of mission runtimes for snappy UI updates,
 * delegates persistence + execution to the server's MissionOrchestrator
 * (see `src/mission/orchestrator.ts`), and watches bus events to stay in
 * sync. A local KV cache (`store.ts`) is the fallback when the server is
 * unreachable.
 */

import type { TuiPluginApi } from "@nikcli-ai/plugin/tui";
import { createStore } from "solid-js/store";
import {
  MissionApi,
  subscribeMissionEvents,
  type MissionDefinition,
  type MissionRuntime,
  type MissionRuntimeStatus,
  type MissionExec,
} from "./sdk";
import * as Store from "./store";

export type {
  MissionDefinition,
  MissionRuntime,
  MissionRuntimeStatus,
  MissionExec,
} from "./sdk";

const EMPTY: MissionRuntime = {
  status: "idle",
  doneFeatures: 0,
  totalFeatures: 0,
};
const [runtimes, setRuntimes] = createStore<Record<string, MissionRuntime>>({});
const sessionByMission: Map<string, string> = new Map();
const tombstones = new Set<string>();

export function runtimeOf(id: string): MissionRuntime {
  return runtimes[id] ?? EMPTY;
}

function patch(
  id: string,
  next: (prev: MissionRuntime) => MissionRuntime,
): void {
  setRuntimes(id, (prev) => next(prev ?? EMPTY));
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === "string") return msg;
  }
  return String(error);
}

/** Drive the server's start endpoint. Returns immediately; updates arrive via bus events. */
export async function start(api: TuiPluginApi, id: string): Promise<void> {
  const api2 = new MissionApi(api.client);
  patch(id, (prev) => ({ ...prev, status: "running", lastError: undefined }));
  const ok = await api2.start(id).catch(() => false);
  if (!ok) {
    patch(id, (prev) => ({
      ...prev,
      status: "error",
      lastError: "Failed to start mission on the server",
    }));
  }
}

/** Persist a new or updated mission via the server. */
export async function persist(
  api: TuiPluginApi,
  def: MissionDefinition,
): Promise<MissionDefinition | undefined> {
  const api2 = new MissionApi(api.client);
  const existing = Store.getById(api.kv, def.id);
  const saved = existing ? await api2.update(def) : await api2.upsert(def);
  if (saved) {
    tombstones.delete(saved.id);
    Store.upsert(api.kv, saved);
    patch(saved.id, (prev) => ({
      ...prev,
      doneFeatures: Store.progressOf(saved).doneFeatures,
      totalFeatures: Store.progressOf(saved).totalFeatures,
    }));
  }
  return saved;
}

export async function remove(api: TuiPluginApi, id: string): Promise<boolean> {
  const api2 = new MissionApi(api.client);
  const ok = await api2.remove(id);
  if (ok) {
    tombstones.add(id);
    Store.removeById(api.kv, id);
    Store.clearHistory(api.kv, id);
    setRuntimes(id, EMPTY);
    sessionByMission.delete(id);
  }
  return ok;
}

export async function pause(api: TuiPluginApi, id: string): Promise<void> {
  const api2 = new MissionApi(api.client);
  patch(id, (prev) => ({ ...prev, status: "paused" }));
  const ok = await api2.pause(id).catch(() => false);
  if (!ok)
    patch(id, (prev) => ({
      ...prev,
      status: "error",
      lastError: "Failed to pause",
    }));
}

export async function cancel(api: TuiPluginApi, id: string): Promise<void> {
  const api2 = new MissionApi(api.client);
  patch(id, (prev) => ({ ...prev, status: "cancelling" }));
  const ok = await api2.cancel(id).catch(() => false);
  if (!ok)
    patch(id, (prev) => ({
      ...prev,
      status: "error",
      lastError: "Failed to cancel",
    }));
}

export async function mutateFeature(
  api: TuiPluginApi,
  id: string,
  featureID: string,
  patch2: Parameters<MissionApi["mutateFeature"]>[2],
): Promise<MissionDefinition | undefined> {
  const api2 = new MissionApi(api.client);
  const next = await api2.mutateFeature(id, featureID, patch2);
  if (next) {
    Store.upsert(api.kv, next);
    patch(id, (prev) => ({
      ...prev,
      doneFeatures: Store.progressOf(next).doneFeatures,
      totalFeatures: Store.progressOf(next).totalFeatures,
    }));
  }
  return next;
}

/** Reconcile the local store with the server's view. Skips tombstones. */
export async function syncWithServer(api: TuiPluginApi): Promise<void> {
  const api2 = new MissionApi(api.client);
  try {
    const { missions, runtimes: list } = await api2.list();
    const ids = new Set(missions.map((m) => m.id));
    for (const id of Array.from(tombstones))
      if (!ids.has(id)) tombstones.delete(id);
    for (const def of missions) {
      if (tombstones.has(def.id)) continue;
      Store.upsert(api.kv, def);
    }
    for (const { missionID, runtime } of list) {
      if (tombstones.has(missionID)) continue;
      setRuntimes(missionID, runtime);
    }
  } catch {
    // server unreachable — keep local cache
  }
}

/** Subscribe to bus events. Returns the unsubscribe function. */
export function subscribeEvents(api: TuiPluginApi): () => void {
  return subscribeMissionEvents(api.event, {
    onUpserted: (missionID) => {
      if (tombstones.has(missionID)) return;
      void syncWithServer(api);
    },
    onRemoved: (missionID) => {
      tombstones.add(missionID);
      setRuntimes(missionID, EMPTY);
      Store.removeById(api.kv, missionID);
      Store.clearHistory(api.kv, missionID);
      sessionByMission.delete(missionID);
    },
    onStarted: (missionID) => {
      patch(missionID, (prev) => ({
        ...prev,
        status: "running",
        lastError: undefined,
      }));
    },
    onFinished: (missionID, status, error) => {
      const next: MissionRuntimeStatus =
        status === "complete"
          ? "idle"
          : status === "paused"
            ? "paused"
            : status === "frozen"
              ? "idle"
              : "error";
      patch(missionID, (prev) => ({
        ...prev,
        status: next,
        lastError: status === "complete" ? undefined : error,
        lastRunAt: Date.now(),
      }));
    },
    onExecStarted: (missionID, execID, kind, targetID, sessionID) => {
      sessionByMission.set(missionID, sessionID);
      Store.recordExec(api.kv, missionID, {
        execID,
        kind,
        targetID,
        targetName: targetID,
        startedAt: Date.now(),
        status: "running",
        ok: false,
        sessionID,
      });
      patch(missionID, (prev) => ({
        ...prev,
        status: "running",
        lastError: undefined,
        ...(sessionID ? { sessionID } : {}),
      }));
    },
    onExecFinished: (missionID, execID, kind, status, ok, error) => {
      Store.updateExec(api.kv, missionID, execID, {
        endedAt: Date.now(),
        status: status as MissionExec["status"],
        ok,
        ...(error ? { error } : {}),
      });
      void syncWithServer(api);
    },
    onRuntimeChanged: (missionID) => {
      void syncWithServer(api);
    },
  });
}

export async function syncAll(api: TuiPluginApi): Promise<void> {
  await syncWithServer(api);
}

// ── Status helpers (pure) ───────────────────────────────────────────────────

export type MissionTone = "muted" | "running" | "error" | "ok" | "frozen";

export function statusInfo(
  def: MissionDefinition | undefined,
  rt: MissionRuntime,
): { label: string; tone: MissionTone } {
  if (rt.status === "running") {
    if (rt.currentFeatureID)
      return { label: `running ${rt.currentFeatureID}`, tone: "running" };
    return { label: "running", tone: "running" };
  }
  if (rt.status === "cancelling")
    return { label: "cancelling", tone: "running" };
  if (rt.status === "error")
    return {
      label: rt.lastError ? `error: ${truncate(rt.lastError, 24)}` : "error",
      tone: "error",
    };
  if (rt.status === "paused") return { label: "paused", tone: "muted" };
  if (def?.status === "frozen") return { label: "frozen", tone: "frozen" };
  if (def?.status === "complete") return { label: "complete", tone: "ok" };
  if (def?.status === "ready") return { label: "ready", tone: "muted" };
  return { label: def?.status ?? "idle", tone: "muted" };
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

// Suppress unused-import lint for the type-only import.
void describeError;
