import z from "zod";
import { Bus } from "@/bus";
import { BusEvent } from "@/bus/bus-event";
import { GlobalBus } from "@/bus/global";
import { Identifier } from "@/id/id";
import { PermissionNext } from "@/permission/next";
import { Project } from "@/project/project";
import { InstanceBootstrap } from "@/project/bootstrap";
import { Instance } from "@/project/instance";
import { Vcs } from "@/project/vcs";
import { Session } from "@/session";
import { SessionPrompt } from "@/session/prompt";
import { SessionStatus } from "@/session/status";
import { SessionRepo } from "@/session/repo";
import { Storage } from "@/storage/storage";
import { fn } from "@/util/fn";
import { Log } from "@/util/log";
import { getAdaptor, listAdaptors } from "./adaptors";
import { ConfigSchema } from "./config";
import { parseSSE } from "./sse";
import { SandboxRegistry } from "@/sandbox/registry";
import { WorkspaceDB } from "./db";
import { SyncEmit, SyncReplay } from "./sync-bridge";
import { SyncUnifyMigration } from "@/sync/migrate-from-workspace";
import { zod, zodObject } from "@/util/effect-zod";
import { Effect, Schema } from "effect";
import {
  runPromiseWithLayer,
  withCurrentInstance,
  runService,
  withInstanceAsync,
} from "@/effect";

function runSession<A, E>(effect: Effect.Effect<A, E, Session.Service>) {
  return runService(Session, effect, withCurrentInstance);
}

function runSessionPrompt<A, E>(
  effect: Effect.Effect<A, E, SessionPrompt.Service>,
) {
  return runService(SessionPrompt, effect, withCurrentInstance);
}

function runVcs<A, E>(effect: Effect.Effect<A, E, Vcs.Service>) {
  return runService(Vcs, effect, withCurrentInstance);
}

export namespace Workspace {
  const ConnectionStatusSchema = Schema.Literals([
    "connecting",
    "connected",
    "disconnected",
    "error",
  ]);
  export const ConnectionStatus = zod(ConnectionStatusSchema);
  export type ConnectionStatus = Schema.Schema.Type<
    typeof ConnectionStatusSchema
  >;

  const ConnectionStatusInfoSchema = Schema.Struct({
    workspaceID: Schema.String.pipe(Schema.check(Schema.isStartsWith("wrk"))),
    status: ConnectionStatusSchema,
  }).annotate({ identifier: "WorkspaceConnectionStatus" });
  export const ConnectionStatusInfo = zodObject(ConnectionStatusInfoSchema);
  export type ConnectionStatusInfo = Schema.Schema.Type<
    typeof ConnectionStatusInfoSchema
  >;

  export const Event = {
    Ready: BusEvent.define(
      "workspace.ready",
      z.object({
        name: z.string(),
      }),
    ),
    Failed: BusEvent.define(
      "workspace.failed",
      z.object({
        message: z.string(),
      }),
    ),
    Status: BusEvent.define(
      "workspace.status",
      z.object({
        workspaceID: Identifier.schema("workspace"),
        status: ConnectionStatus,
      }),
    ),
  };

  const InfoSchema = Schema.Struct({
    id: Schema.String.pipe(Schema.check(Schema.isStartsWith("wrk"))),
    name: Schema.String,
    timeUsed: Schema.Number,
    branch: Schema.NullOr(Schema.String),
    projectID: Schema.String,
    config: ConfigSchema,
  }).annotate({ identifier: "Workspace" });
  export const Info = zodObject(InfoSchema);
  export type Info = Schema.Schema.Type<typeof InfoSchema>;

  function runPermission<A, E>(
    effect: Effect.Effect<A, E, PermissionNext.Service>,
  ) {
    return runService(PermissionNext, effect, withCurrentInstance);
  }

  function hydrateStatus(sessionID: string, status: SessionStatus.Info) {
    return runPromiseWithLayer(
      SessionStatus.defaultLayer,
      withCurrentInstance(
        Effect.gen(function* () {
          const sessionStatus = yield* SessionStatus.Service;
          return yield* sessionStatus.hydrate(sessionID, status);
        }),
      ),
    );
  }

  const RestoreSchema = Schema.Struct({
    workspaceID: Schema.String.pipe(Schema.check(Schema.isStartsWith("wrk"))),
    sessions: Schema.Array(Schema.String).pipe(
      Schema.optional,
      Schema.withDecodingDefault(Effect.succeed([] as ReadonlyArray<string>)),
    ),
    events: Schema.Array(Schema.Unknown).pipe(
      Schema.optional,
      Schema.withDecodingDefault(Effect.succeed([] as ReadonlyArray<unknown>)),
    ),
  }).annotate({ identifier: "Workspace.Restore" });
  export const Restore = zodObject(RestoreSchema);
  export type Restore = Schema.Schema.Type<typeof RestoreSchema>;

  const SessionRestoreSchema = Schema.Struct({
    workspaceID: Schema.String.pipe(Schema.check(Schema.isStartsWith("wrk"))),
    sessions: Schema.Array(Schema.String).pipe(
      Schema.optional,
      Schema.withDecodingDefault(Effect.succeed([] as ReadonlyArray<string>)),
    ),
    events: Schema.Array(Schema.Unknown).pipe(
      Schema.optional,
      Schema.withDecodingDefault(Effect.succeed([] as ReadonlyArray<unknown>)),
    ),
    sessionID: Schema.String.pipe(Schema.check(Schema.isStartsWith("ses"))),
  }).annotate({ identifier: "Workspace.SessionRestore" });
  export const SessionRestore = zodObject(SessionRestoreSchema);
  export type SessionRestore = Schema.Schema.Type<typeof SessionRestoreSchema>;

  /**
   * Human-friendly workspace name. Mirrors opencode: the worktree directory's
   * basename (its slug). Falls back to the directory basename for any adaptor.
   */
  function deriveName(config: WorkspaceDB.Info["config"]): string {
    const directory = config.directory;
    if (!directory) return "";
    return directory.split(/[\\/]/).filter(Boolean).pop() ?? "";
  }

  function fromRow(row: WorkspaceDB.Info): Info {
    return Info.parse({
      ...row,
      name: row.name ?? "",
      timeUsed: row.timeUsed ?? Date.now(),
      branch: row.branch ?? null,
    });
  }

  const syncControllers = new Map<string, AbortController>();
  const connectionStatuses = new Map<string, ConnectionStatus>();
  const startingSync = new Set<string>(); // Mutex to prevent concurrent sync starts
  const RESTORE_EVENT_TYPES = new Set([
    "session.created",
    "session.updated",
    "session.deleted",
    "session.status",
    "session.idle",
    "permission.asked",
    "permission.replied",
    "question.asked",
    "question.replied",
    "question.rejected",
    Event.Ready.type,
    Event.Failed.type,
    Event.Status.type,
  ]);

  async function listRootSessions(workspaceID: string) {
    return SessionRepo.getByProject(Instance.project.id)
      .filter(
        (session) => session.workspaceID === workspaceID && !session.parentID,
      )
      .toSorted((a, b) => b.time.updated - a.time.updated)
      .map((session) => session.id);
  }

  async function buildRestorePayload(workspaceID: string): Promise<Restore> {
    // The unified log also journals lifecycle events (workspace.created,
    // workspace.removed, ...) for cold-start projection; the restore payload
    // only carries the client-facing restore events.
    const events = (await SyncReplay.workspaceEvents(workspaceID)).filter(
      (event) => {
        const type = (event as { type?: unknown })?.type;
        return typeof type === "string" && RESTORE_EVENT_TYPES.has(type);
      },
    );
    return {
      workspaceID,
      sessions: await listRootSessions(workspaceID),
      events,
    };
  }

  export function status(workspaceID: string): ConnectionStatus {
    return (connectionStatuses.get(workspaceID) ??
      WorkspaceDB.getStatus(workspaceID) ??
      "disconnected") as ConnectionStatus;
  }

  function setStatus(workspaceID: string, next: ConnectionStatus) {
    const prev = connectionStatuses.get(workspaceID);
    if (prev === next) return;
    connectionStatuses.set(workspaceID, next);
    WorkspaceDB.setStatusColumn(workspaceID, next);
    void Bus.publish(Event.Status, { workspaceID, status: next }).catch(
      () => undefined,
    );
  }

  function syncDirectory(space: Info) {
    if (space.config.type === "worktree") return;
    return space.config.directory;
  }

  function eventSessionID(event: { properties?: any }) {
    const properties = event.properties;
    if (!properties || typeof properties !== "object") return;
    if (typeof properties.sessionID === "string") return properties.sessionID;
    if (
      typeof properties.info?.id === "string" &&
      properties.info.id.startsWith("ses")
    )
      return properties.info.id;
    if (typeof properties.info?.sessionID === "string")
      return properties.info.sessionID;
    if (typeof properties.part?.sessionID === "string")
      return properties.part.sessionID;
  }

  function eventWorkspaceID(event: { properties?: any }) {
    const workspaceID = event.properties?.info?.workspaceID;
    return typeof workspaceID === "string" ? workspaceID : undefined;
  }

  async function acceptsWorkspaceEvent(
    workspaceID: string,
    event: { type?: string; properties?: any },
  ) {
    if (!event?.type || event.type === "server.heartbeat") return false;
    const declaredWorkspaceID = eventWorkspaceID(event);
    if (declaredWorkspaceID && declaredWorkspaceID !== workspaceID)
      return false;

    const sessionID = eventSessionID(event);
    if (!sessionID) return true;

    const session = await runSession(
      Effect.gen(function* () {
        const sessions = yield* Session.Service;
        return yield* sessions.getAnyProject(sessionID);
      }),
    ).catch(() => undefined);

    if (!session)
      return (
        declaredWorkspaceID === undefined || declaredWorkspaceID === workspaceID
      );
    return session.workspaceID === workspaceID;
  }

  async function mirrorWorkspaceEvent(
    space: Info,
    event: { type?: string; properties?: any },
  ) {
    const directory = syncDirectory(space);
    if (!directory || !event?.type) return;

    await withInstanceAsync(
      { directory, init: InstanceBootstrap },
      async () => {
        if (
          event.type === "session.status" &&
          event.properties?.sessionID &&
          event.properties?.status
        ) {
          await hydrateStatus(
            event.properties.sessionID,
            event.properties.status,
          );
        }

        if (event.type === "session.idle" && event.properties?.sessionID) {
          await hydrateStatus(event.properties.sessionID, { type: "idle" });
        }

        if (event.type === "permission.asked" && event.properties?.id) {
          await runPermission(
            Effect.gen(function* () {
              const permission = yield* PermissionNext.Service;
              yield* permission.hydrateAsk(event.properties);
            }),
          );
        }

        if (
          event.type === "permission.replied" &&
          event.properties?.requestID
        ) {
          await runPermission(
            Effect.gen(function* () {
              const permission = yield* PermissionNext.Service;
              yield* permission.hydrateReply(event.properties.requestID);
            }),
          );
        }
      },
    );
  }

  function rememberWorkspaceEvent(
    workspaceID: string,
    event: { type?: string; properties?: any },
  ) {
    if (!event?.type || event.type === "server.heartbeat") return;
    if (!RESTORE_EVENT_TYPES.has(event.type)) return;
    // Phase 0: route workspace-bound events through the unified event log.
    // The aggregate is the workspace id; this lets the same projector chain
    // reconstruct the workspace's event timeline from cold start.
    void SyncEmit.workspaceEvent(Instance.project.id, workspaceID, event).catch(
      (error) => {
        log.warn("workspace event sync emit failed", { workspaceID, error });
      },
    );
  }

  function startSpaceSync(space: Info) {
    if (space.config.type === "worktree") return;
    if (syncControllers.has(space.id)) return;
    // Atomic check-and-set using starting mutex
    if (startingSync.has(space.id)) return;
    startingSync.add(space.id);

    const stop = new AbortController();
    syncControllers.set(space.id, stop);

    void workspaceEventLoop(space, stop.signal)
      .catch((error) => {
        log.warn("workspace sync listener failed", {
          workspaceID: space.id,
          error,
        });
      })
      .finally(() => {
        if (syncControllers.get(space.id) === stop)
          syncControllers.delete(space.id);
        startingSync.delete(space.id);
      });
  }

  function stopSpaceSync(id: string) {
    const controller = syncControllers.get(id);
    if (!controller) return;
    controller.abort();
    syncControllers.delete(id);
  }

  export const create = fn(
    z.object({
      id: Identifier.schema("workspace").optional(),
      projectID: Info.shape.projectID,
      branch: Info.shape.branch,
      config: Info.shape.config,
    }),
    async (input) => {
      const id = Identifier.ascending("workspace", input.id);

      const created = await getAdaptor(input.config).create(
        input.config,
        input.branch,
        id,
      );
      const { config, init } = created;

      const info: Info = {
        id,
        projectID: input.projectID,
        name: created.name ?? deriveName(config),
        timeUsed: Date.now(),
        branch: input.branch,
        config,
      };

      let previousInfo: WorkspaceDB.Info | undefined;
      let wroteDB = false;

      try {
        await init();
        await WorkspaceDB.migrateFromStorage();
        previousInfo = WorkspaceDB.get(id);
        WorkspaceDB.upsert(info);
        wroteDB = true;
        WorkspaceDB.setStatusColumn(
          id,
          info.config.type === "worktree" ? "connected" : "connecting",
        );
        // Phase 0: emit a workspace.created event so the unified event log
        // can replay the workspace lifecycle from cold start. The aggregate
        // is the workspace id; data carries the bootstrap info.
        void SyncEmit.workspaceLifecycle(
          input.projectID,
          id,
          "workspace.created",
          {
            config: info.config,
            branch: info.branch,
            name: info.name,
          },
        ).catch((error) => {
          log.warn("workspace.created sync emit failed", {
            workspaceID: id,
            error,
          });
        });
        startSpaceSync(info);
      } catch (error) {
        stopSpaceSync(id);
        if (wroteDB) {
          if (previousInfo) {
            WorkspaceDB.upsert(previousInfo);
          } else {
            WorkspaceDB.remove(id);
          }
        }
        SandboxRegistry.invalidateWorkspace(id);
        connectionStatuses.delete(id);
        await getAdaptor(config)
          .remove(config)
          .catch((cleanupError) => {
            log.warn("workspace create cleanup failed", {
              workspaceID: id,
              error: cleanupError,
            });
          });
        throw error;
      }

      GlobalBus.emit("event", {
        directory: id,
        payload: {
          type: Event.Ready.type,
          properties: {},
        },
      });

      return info;
    },
  );

  export async function list(project: Project.Info) {
    await WorkspaceDB.migrateFromStorage();
    // Phase 0: ensure pre-existing workspaces are seeded into the
    // unified event log so the projector can replay them.
    await SyncUnifyMigration.run(project.id).catch((error) => {
      log.warn("workspace sync-unify migration failed", {
        projectID: project.id,
        error,
      });
    });
    return WorkspaceDB.list(project.id).map(fromRow);
  }

  /**
   * Auto-discover workspaces that exist for the project (e.g. git worktrees) but
   * are not yet tracked in the DB, and register them. Mirrors opencode's
   * `Workspace.syncList`: every adaptor with a `list()` is asked to enumerate
   * its live workspaces, and any whose directory isn't already tracked is
   * inserted into the DB and (for non-worktree types) wired into the sync loop.
   */
  export async function syncList(project: Project.Info) {
    const existing = await list(project);
    const knownDirectories = new Set(
      existing
        .map((space) => space.config.directory)
        .filter((directory): directory is string => Boolean(directory)),
    );
    const knownNames = new Set(
      existing.map((space) => space.name).filter(Boolean),
    );

    const discovered = (
      await Promise.all(
        listAdaptors().map(({ type, adaptor }) =>
          adaptor.list
            ? adaptor.list().catch((error) => {
                log.warn("workspace adaptor list failed", { type, error });
                return [];
              })
            : Promise.resolve([]),
        ),
      )
    ).flat();

    for (const item of discovered) {
      if (item.config.directory && knownDirectories.has(item.config.directory))
        continue;
      if (item.name && knownNames.has(item.name)) continue;
      knownDirectories.add(item.config.directory ?? "");
      knownNames.add(item.name);

      const info: Info = {
        id: Identifier.ascending("workspace"),
        projectID: project.id,
        name: item.name || deriveName(item.config),
        timeUsed: Date.now(),
        branch: item.branch,
        config: item.config,
      };
      WorkspaceDB.upsert(info);
      WorkspaceDB.setStatusColumn(
        info.id,
        info.config.type === "worktree" ? "connected" : "connecting",
      );
      // Phase 0: same workspace.created emit as the create() path, so
      // discovered workspaces have a presence in the unified event log.
      void SyncEmit.workspaceLifecycle(
        project.id,
        info.id,
        "workspace.created",
        {
          config: info.config,
          branch: info.branch,
          name: info.name,
        },
      ).catch((error) => {
        log.warn("workspace.created sync emit failed (discovered)", {
          workspaceID: info.id,
          error,
        });
      });
      startSpaceSync(info);
    }

    return list(project);
  }

  export const get = fn(Identifier.schema("workspace"), async (id) => {
    await WorkspaceDB.migrateFromStorage();
    const row = WorkspaceDB.get(id);
    return row ? fromRow(row) : undefined;
  });

  export const sandbox = fn(Identifier.schema("workspace"), async (id) => {
    const info = await get(id);
    if (!info) return undefined;
    return SandboxRegistry.resolve({
      type: "workspace",
      workspaceID: info.id,
    });
  });

  export const target = fn(Identifier.schema("workspace"), async (id) => {
    const resolved = await sandbox(id);
    if (!resolved) return undefined;
    return resolved.target();
  });

  export const remove = fn(Identifier.schema("workspace"), async (id) => {
    const info = await get(id);
    if (info) {
      stopSpaceSync(id);
      for (const sessionID of await listRootSessions(id)) {
        await runSession(
          Effect.gen(function* () {
            const session = yield* Session.Service;
            yield* session.remove(sessionID);
          }),
        ).catch((error) => {
          if (error instanceof Storage.NotFoundError) return;
          throw error;
        });
      }
      await getAdaptor(info.config).remove(info.config);
      WorkspaceDB.remove(id);
      SandboxRegistry.invalidateWorkspace(id);
      connectionStatuses.delete(id);
      return info;
    }
  });
  const log = Log.create({ service: "workspace-sync" });

  async function workspaceEventLoop(space: Info, stop: AbortSignal) {
    const target = await Workspace.target(space.id);

    if (!target || target.type === "local") return;

    const baseURL = String(target.url).replace(/\/?$/, "/");
    const BACKOFF_BASE_MS = 1000;
    const BACKOFF_CAP_MS = 30_000;
    let backoff = BACKOFF_BASE_MS;

    try {
      while (!stop.aborted) {
        setStatus(space.id, "connecting");
        const res = await fetch(new URL(baseURL + "event"), {
          method: "GET",
          headers: target.headers,
          signal: stop,
        }).catch(() => undefined);
        if (!res || !res.ok || !res.body) {
          setStatus(space.id, "error");
          await Bun.sleep(backoff);
          backoff = Math.min(backoff * 2, BACKOFF_CAP_MS);
          continue;
        }
        backoff = BACKOFF_BASE_MS;
        setStatus(space.id, "connected");
        await parseSSE(res.body, stop, (event) => {
          const payload = event as { type?: string; properties?: any };
          void acceptsWorkspaceEvent(space.id, payload)
            .then((accepted) => {
              if (!accepted) return;
              rememberWorkspaceEvent(space.id, payload);
              void mirrorWorkspaceEvent(space, payload).catch((error) => {
                log.warn("workspace event mirror failed", {
                  workspaceID: space.id,
                  error,
                  type: payload?.type,
                });
              });
              GlobalBus.emit("event", {
                directory: space.id,
                payload,
              });
            })
            .catch((error) => {
              log.warn("workspace event ownership check failed", {
                workspaceID: space.id,
                error,
                type: payload?.type,
              });
            });
        });
        if (!stop.aborted) setStatus(space.id, "connecting");
        await Bun.sleep(250);
      }
    } finally {
      setStatus(space.id, "disconnected");
    }
  }

  export function startSyncing(project: Project.Info) {
    void (async () => {
      // Discover any untracked worktrees first (opencode parity), then start
      // sync loops for the non-worktree workspaces.
      const spaces = await syncList(project).catch(async (error) => {
        log.warn("workspace syncList failed", { project: project.id, error });
        return list(project);
      });
      for (const space of spaces) {
        if (space.config.type !== "worktree") {
          startSpaceSync(space);
          continue;
        }
        const healthy = await Promise.resolve(
          getAdaptor(space.config).healthCheck?.(space.config),
        ).catch(() => false);
        setStatus(space.id, healthy === false ? "error" : "connected");
      }
    })();

    return {
      async stop() {
        const spaces = await list(project);
        spaces.forEach((space) => stopSpaceSync(space.id));
      },
    };
  }

  export function stopAllSyncing() {
    for (const id of [...syncControllers.keys()]) {
      stopSpaceSync(id);
    }
  }

  export async function statuses(
    project: Project.Info,
  ): Promise<ConnectionStatusInfo[]> {
    return (await list(project)).map((space) => ({
      workspaceID: space.id,
      status: status(space.id),
    }));
  }

  export const JournalEvent = z.object({
    seq: z.number().int(),
    type: z.string(),
    data: z.unknown(),
    timestamp: z.number(),
  });
  export type JournalEvent = z.infer<typeof JournalEvent>;

  /**
   * Sequenced event journal for a workspace, read from the unified sync
   * event log. Clients that missed SSE events (reconnect, mobile resume)
   * can catch up incrementally by passing the last sequence number they saw.
   */
  export const events = fn(
    z.object({
      workspaceID: Identifier.schema("workspace"),
      from: z.number().int().nonnegative().optional(),
    }),
    async ({ workspaceID, from }): Promise<JournalEvent[]> => {
      const info = await get(workspaceID);
      if (!info)
        throw new Storage.NotFoundError({
          message: `Workspace not found: ${workspaceID}`,
        });
      const { SyncStorage } = await import("@/sync");
      const records = await SyncStorage.getEvents(
        info.projectID,
        workspaceID,
        from,
      );
      return records.map((record) => ({
        seq: record.seq,
        type: record.type,
        data: record.data,
        timestamp: record.timestamp,
      }));
    },
  );

  // Cleanup global state on process exit (register once per process)
  function cleanup() {
    log.info("cleanup: stopping all workspace sync loops");
    stopAllSyncing();
    connectionStatuses.clear();
  }

  let workspaceCleanupRegistered = false;
  if (!workspaceCleanupRegistered) {
    workspaceCleanupRegistered = true;
    const cleanupOnce = () => {
      workspaceCleanupRegistered = false;
      cleanup();
    };
    process.once("beforeExit", cleanupOnce);
    process.once("SIGTERM", cleanupOnce);
    process.once("SIGINT", cleanupOnce);
  }

  /**
   * Ensures the workspace's event sync loop is running and resolves once the
   * workspace reports `connected` (or rejects on timeout / abort).
   * For local workspaces the promise resolves immediately.
   */
  export const restore = fn(
    z.object({
      workspaceID: Identifier.schema("workspace"),
      timeoutMs: z.number().int().positive().default(30_000),
      signal: z.any().optional(),
    }),
    async ({ workspaceID, timeoutMs, signal }) => {
      const info = await get(workspaceID);
      if (!info)
        throw new Storage.NotFoundError({
          message: `Workspace not found: ${workspaceID}`,
        });
      if (info.config.type === "worktree") {
        setStatus(workspaceID, "connected");
        return buildRestorePayload(workspaceID);
      }
      startSpaceSync(info);
      const currentStatus = connectionStatuses.get(workspaceID);
      if (currentStatus === "connected")
        return buildRestorePayload(workspaceID);
      if (currentStatus === "error") {
        throw new Error(`Workspace failed to connect: ${workspaceID}`);
      }
      const { EventLoop } = await import("@/util/eventloop");
      const settled = await EventLoop.waitEvent({
        event: Event.Status,
        timeoutMs,
        signal: signal as AbortSignal | undefined,
        predicate: (p) =>
          p.workspaceID === workspaceID &&
          (p.status === "connected" || p.status === "error"),
      });
      if (settled.status !== "connected") {
        throw new Error(`Workspace failed to connect: ${workspaceID}`);
      }
      return buildRestorePayload(workspaceID);
    },
  );

  export const sessionRestore = fn(
    z.object({
      workspaceID: Identifier.schema("workspace"),
      sessionID: Identifier.schema("session"),
      timeoutMs: z.number().int().positive().default(30_000),
      signal: z.any().optional(),
    }),
    async ({ workspaceID, sessionID, timeoutMs, signal }) => {
      await restore({ workspaceID, timeoutMs, signal });
      await runSession(
        Effect.gen(function* () {
          const session = yield* Session.Service;
          yield* session.update(sessionID, (draft) => {
            draft.workspaceID = workspaceID;
          });
        }),
      );
      const payload = await buildRestorePayload(workspaceID);
      return {
        ...payload,
        sessionID,
      };
    },
  );

  /**
   * Move a session between workspaces, or detach it back to the local project.
   * Pass `workspaceID: null` to clear the session's workspaceID.
   */
  export const sessionWarp = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      workspaceID: z.union([Identifier.schema("workspace"), z.null()]),
      copyChanges: z.boolean().optional(),
      timeoutMs: z.number().int().positive().default(30_000),
      signal: z.any().optional(),
    }),
    async ({ sessionID, workspaceID, copyChanges, timeoutMs, signal }) => {
      const current = await runSession(
        Effect.gen(function* () {
          const session = yield* Session.Service;
          return yield* session.getAnyProject(sessionID);
        }),
      );

      if (current.workspaceID) {
        const previous = await get(current.workspaceID);
        if (previous?.config.type !== "worktree") {
          if (previous) {
            await restore({
              workspaceID: previous.id,
              timeoutMs,
              signal,
            }).catch((error) => {
              log.warn("session warp final source sync failed", {
                workspaceID: previous.id,
                sessionID,
                error,
              });
            });
          } else {
            await runSessionPrompt(
              Effect.gen(function* () {
                const prompt = yield* SessionPrompt.Service;
                yield* prompt.cancel(sessionID);
              }),
            );
          }
        } else {
          await runSessionPrompt(
            Effect.gen(function* () {
              const prompt = yield* SessionPrompt.Service;
              yield* prompt.cancel(sessionID);
            }),
          );
        }
      } else {
        await runSessionPrompt(
          Effect.gen(function* () {
            const prompt = yield* SessionPrompt.Service;
            yield* prompt.cancel(sessionID);
          }),
        );
      }

      const target = workspaceID
        ? await restore({ workspaceID, timeoutMs, signal }).then(() =>
            targetWorkspace(workspaceID),
          )
        : undefined;

      const sourcePatch =
        copyChanges && current.workspaceID
          ? await workspaceDiffRaw(
              current.workspaceID,
              signal as AbortSignal | undefined,
            ).catch((error) => {
              log.warn("session warp source patch read failed", {
                workspaceID: current.workspaceID,
                sessionID,
                error,
              });
              return "";
            })
          : "";

      if (sourcePatch) {
        await applyWorkspacePatch({
          workspaceID,
          fallbackDirectory: current.directory,
          patch: sourcePatch,
          signal: signal as AbortSignal | undefined,
        });
      }

      await runSession(
        Effect.gen(function* () {
          const session = yield* Session.Service;
          yield* session.update(sessionID, (draft) => {
            draft.workspaceID = workspaceID ?? undefined;
          });
        }),
      );

      if (workspaceID && target?.type === "remote") {
        const headers = new Headers(target.headers);
        headers.set("content-type", "application/json");
        headers.set("x-nikcli-workspace", workspaceID);
        const response = await fetch(new URL("/sync/steal", target.url), {
          method: "POST",
          headers,
          body: JSON.stringify({ sessionID }),
          signal,
        });
        if (!response.ok) {
          const body = await response.text().catch(() => "");
          throw new Error(
            `Failed to warp session into workspace ${workspaceID}: HTTP ${response.status} ${body}`,
          );
        }
      }

      return {
        sessionID,
        workspaceID: workspaceID ?? null,
      };
    },
  );

  async function runVcsInDirectory<A, E>(
    directory: string,
    effect: Effect.Effect<A, E, Vcs.Service>,
  ) {
    return withInstanceAsync({ directory, init: InstanceBootstrap }, async () =>
      runVcs(effect),
    );
  }

  async function workspaceDiffRaw(workspaceID: string, signal?: AbortSignal) {
    const target = await targetWorkspace(workspaceID);
    if (!target) return "";

    if (target.type === "local") {
      return runVcsInDirectory(
        target.directory,
        Effect.gen(function* () {
          const vcs = yield* Vcs.Service;
          return yield* vcs.diffRaw();
        }),
      );
    }

    const response = await fetch(new URL("/vcs/diff/raw", target.url), {
      headers: target.headers,
      signal,
    }).catch((error) => {
      log.warn("workspace diff raw request failed", { workspaceID, error });
      return undefined;
    });
    if (!response?.ok) {
      if (response) {
        log.warn("workspace diff raw request failed", {
          workspaceID,
          status: response.status,
          body: await response.text().catch(() => ""),
        });
      }
      return "";
    }
    return response.text();
  }

  async function applyWorkspacePatch(input: {
    workspaceID: string | null;
    fallbackDirectory: string;
    patch: string;
    signal?: AbortSignal;
  }) {
    const target = input.workspaceID
      ? await targetWorkspace(input.workspaceID)
      : undefined;

    if (target?.type === "remote") {
      const headers = new Headers(target.headers);
      headers.set("content-type", "application/json");
      const response = await fetch(new URL("/vcs/apply", target.url), {
        method: "POST",
        headers,
        body: JSON.stringify({ patch: input.patch }),
        signal: input.signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Vcs.PatchApplyError({
          message:
            body || `Failed to apply workspace patch: HTTP ${response.status}`,
          reason: "not-clean",
        });
      }
      return;
    }

    const directory =
      target?.type === "local" ? target.directory : input.fallbackDirectory;
    await runVcsInDirectory(
      directory,
      Effect.gen(function* () {
        const vcs = yield* Vcs.Service;
        return yield* vcs.apply({ patch: input.patch });
      }),
    );
  }

  async function targetWorkspace(workspaceID: string) {
    const info = await get(workspaceID);
    if (!info)
      throw new Storage.NotFoundError({
        message: `Workspace not found: ${workspaceID}`,
      });
    return Workspace.target(info.id);
  }
}
