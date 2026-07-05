import z from "zod"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import { Identifier } from "@/id/id"
import { Project } from "@/project/project"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Instance } from "@/project/instance"
import { Vcs } from "@/project/vcs"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionRepo } from "@/session/repo"
import { Storage } from "@/storage/storage"
import { fn } from "@/util/fn"
import { Log } from "@/util/log"
import { getAdaptor, listAdaptors } from "./adaptors"
import { ConfigSchema } from "./config"
import { SandboxRegistry } from "@/sandbox/registry"
import { WorkspaceDB } from "./db"
import { WorkspaceProjection } from "./projection"
import {
  WorkspaceConnection,
  ConnectionStatus as _ConnectionStatus,
  ConnectionStatusInfo as _ConnectionStatusInfo,
} from "./connection"
import type { WorkspaceInfo } from "./types"
import { SyncUnifyMigration } from "@/sync/migrate-from-workspace"
import { zod, zodObject } from "@/util/effect-zod"
import { Effect, Schema } from "effect"
import { runService, withInstanceAsync, withCurrentInstance } from "@/effect"

function runSession<A, E>(effect: Effect.Effect<A, E, Session.Service>) {
  return runService(Session, effect, withCurrentInstance)
}

function runSessionPrompt<A, E>(effect: Effect.Effect<A, E, SessionPrompt.Service>) {
  return runService(SessionPrompt, effect, withCurrentInstance)
}

function runVcs<A, E>(effect: Effect.Effect<A, E, Vcs.Service>) {
  return runService(Vcs, effect, withCurrentInstance)
}

export namespace Workspace {
  // The connection module owns the runtime values. We re-export the type
  // definitions to keep callers using `Workspace.ConnectionStatus` working
  // without forcing eager evaluation of the connection module's runtime
  // bindings (which would create a TDZ when both files import each other).
  // The runtime `ConnectionStatus` value (used by `Event.Status` schema) is
  // declared locally as a Zod enum mirroring the connection module so the
  // namespace exposes both a value and a type at the same name.
  export const ConnectionStatus = z.enum(["connecting", "connected", "disconnected", "error"])
  export type ConnectionStatus = import("./connection").ConnectionStatus
  export type ConnectionStatusInfo = import("./connection").ConnectionStatusInfo

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
  }

  const InfoSchema = Schema.Struct({
    id: Schema.String.pipe(Schema.check(Schema.isStartsWith("wrk"))),
    name: Schema.String,
    timeUsed: Schema.Number,
    branch: Schema.NullOr(Schema.String),
    projectID: Schema.String,
    config: ConfigSchema,
  }).annotate({ identifier: "Workspace" })
  export const Info = zodObject(InfoSchema)
  export type Info = Schema.Schema.Type<typeof InfoSchema>

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
  }).annotate({ identifier: "Workspace.Restore" })
  export const Restore = zodObject(RestoreSchema)
  export type Restore = Schema.Schema.Type<typeof RestoreSchema>

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
  }).annotate({ identifier: "Workspace.SessionRestore" })
  export const SessionRestore = zodObject(SessionRestoreSchema)
  export type SessionRestore = Schema.Schema.Type<typeof SessionRestoreSchema>

  /**
   * Human-friendly workspace name. Mirrors opencode: the worktree directory's
   * basename (its slug). Falls back to the directory basename for any adaptor.
   */
  function deriveName(config: WorkspaceDB.Info["config"]): string {
    const directory = config.directory
    if (!directory) return ""
    return directory.split(/[\\/]/).filter(Boolean).pop() ?? ""
  }

  function fromRow(row: WorkspaceDB.Info): Info {
    return Info.parse({
      ...row,
      name: row.name ?? "",
      timeUsed: row.timeUsed ?? Date.now(),
      branch: row.branch ?? null,
    })
  }

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
  ])

  async function listRootSessions(workspaceID: string) {
    return SessionRepo.getByProject(Instance.project.id)
      .filter((session) => session.workspaceID === workspaceID && !session.parentID)
      .toSorted((a, b) => b.time.updated - a.time.updated)
      .map((session) => session.id)
  }

  async function buildRestorePayload(workspaceID: string): Promise<Restore> {
    // The unified log also journals lifecycle events (workspace.created,
    // workspace.removed, ...) for cold-start projection; the restore payload
    // only carries the client-facing restore events.
    const events = (await WorkspaceProjection.events(workspaceID)).filter((event) => {
      const type = (event as { type?: unknown })?.type
      return typeof type === "string" && RESTORE_EVENT_TYPES.has(type)
    })
    return {
      workspaceID,
      sessions: await listRootSessions(workspaceID),
      events,
    }
  }

  export function status(workspaceID: string): ConnectionStatus {
    return WorkspaceConnection.status(workspaceID)
  }

  function startSpaceSync(space: Info) {
    void Workspace.target(space.id).then((target) => WorkspaceConnection.start(space as WorkspaceInfo, target))
  }

  function stopSpaceSync(id: string) {
    WorkspaceConnection.stop(id)
  }

  export const create = fn(
    z.object({
      id: Identifier.schema("workspace").optional(),
      projectID: Info.shape.projectID,
      branch: Info.shape.branch,
      config: Info.shape.config,
    }),
    async (input) => {
      const id = Identifier.ascending("workspace", input.id)

      const created = await getAdaptor(input.config).create(input.config, input.branch, id)
      const { config, init } = created

      const info: Info = {
        id,
        projectID: input.projectID,
        name: created.name ?? deriveName(config),
        timeUsed: Date.now(),
        branch: input.branch,
        config,
      }

      let previousInfo: WorkspaceDB.Info | undefined
      let wroteDB = false

      try {
        await init()
        await WorkspaceDB.migrateFromStorage()
        previousInfo = WorkspaceDB.get(id)
        await WorkspaceProjection.emitLifecycle(input.projectID, id, "workspace.created", {
          config: info.config,
          branch: info.branch,
          name: info.name,
          timeUsed: info.timeUsed,
        })
        wroteDB = true
        WorkspaceDB.setStatusColumn(id, info.config.type === "worktree" ? "connected" : "connecting")
        startSpaceSync(info)
      } catch (error) {
        stopSpaceSync(id)
        if (wroteDB) {
          if (previousInfo) {
            WorkspaceDB.upsert(previousInfo)
          } else {
            WorkspaceDB.remove(id)
          }
        }
        SandboxRegistry.invalidateWorkspace(id)
        WorkspaceConnection.forget(id)
        await getAdaptor(config)
          .remove(config)
          .catch((cleanupError) => {
            log.warn("workspace create cleanup failed", {
              workspaceID: id,
              error: cleanupError,
            })
          })
        throw error
      }

      GlobalBus.emit("event", {
        directory: id,
        payload: {
          type: Event.Ready.type,
          properties: {},
        },
      })

      return info
    },
  )

  export async function list(project: Project.Info) {
    await WorkspaceDB.migrateFromStorage()
    // Phase 0: ensure pre-existing workspaces are seeded into the
    // unified event log so the projector can replay them.
    await SyncUnifyMigration.run(project.id).catch((error) => {
      log.warn("workspace sync-unify migration failed", {
        projectID: project.id,
        error,
      })
    })
    return WorkspaceDB.list(project.id).map(fromRow)
  }

  /**
   * Auto-discover workspaces that exist for the project (e.g. git worktrees) but
   * are not yet tracked in the DB, and register them. Mirrors opencode's
   * `Workspace.syncList`: every adaptor with a `list()` is asked to enumerate
   * its live workspaces, and any whose directory isn't already tracked is
   * inserted into the DB and (for non-worktree types) wired into the sync loop.
   */
  export async function syncList(project: Project.Info) {
    const existing = await list(project)
    const knownDirectories = new Set(
      existing.map((space) => space.config.directory).filter((directory): directory is string => Boolean(directory)),
    )
    const knownNames = new Set(existing.map((space) => space.name).filter(Boolean))

    const discovered = (
      await Promise.all(
        listAdaptors().map(({ type, adaptor }) =>
          adaptor.list
            ? adaptor.list().catch((error) => {
                log.warn("workspace adaptor list failed", { type, error })
                return []
              })
            : Promise.resolve([]),
        ),
      )
    ).flat()

    for (const item of discovered) {
      if (item.config.directory && knownDirectories.has(item.config.directory)) continue
      if (item.name && knownNames.has(item.name)) continue
      knownDirectories.add(item.config.directory ?? "")
      knownNames.add(item.name)

      const info: Info = {
        id: Identifier.ascending("workspace"),
        projectID: project.id,
        name: item.name || deriveName(item.config),
        timeUsed: Date.now(),
        branch: item.branch,
        config: item.config,
      }
      await WorkspaceProjection.emitLifecycle(project.id, info.id, "workspace.created", {
        config: info.config,
        branch: info.branch,
        name: info.name,
        timeUsed: info.timeUsed,
      }).catch((error) => {
        log.warn("workspace.created projection failed (discovered)", {
          workspaceID: info.id,
          error,
        })
        WorkspaceDB.upsert(info)
      })
      WorkspaceDB.setStatusColumn(info.id, info.config.type === "worktree" ? "connected" : "connecting")
      startSpaceSync(info)
    }

    return list(project)
  }

  export const get = fn(Identifier.schema("workspace"), async (id) => {
    await WorkspaceDB.migrateFromStorage()
    const row = WorkspaceDB.get(id)
    return row ? fromRow(row) : undefined
  })

  export const sandbox = fn(Identifier.schema("workspace"), async (id) => {
    const info = await get(id)
    if (!info) return undefined
    return SandboxRegistry.resolve({
      type: "workspace",
      workspaceID: info.id,
    })
  })

  export const target = fn(Identifier.schema("workspace"), async (id) => {
    const resolved = await sandbox(id)
    if (!resolved) return undefined
    return resolved.target()
  })

  export const remove = fn(Identifier.schema("workspace"), async (id) => {
    const info = await get(id)
    if (info) {
      stopSpaceSync(id)
      for (const sessionID of await listRootSessions(id)) {
        await runSession(
          Effect.gen(function* () {
            const session = yield* Session.Service
            yield* session.remove(sessionID)
          }),
        ).catch((error) => {
          if (error instanceof Storage.NotFoundError) return
          throw error
        })
      }
      await getAdaptor(info.config).remove(info.config)
      await WorkspaceProjection.emitLifecycle(info.projectID, id, "workspace.removed", {}).catch((error) => {
        log.warn("workspace.removed projection failed", {
          workspaceID: id,
          error,
        })
        WorkspaceDB.remove(id)
      })
      SandboxRegistry.invalidateWorkspace(id)
      WorkspaceConnection.forget(id)
      return info
    }
  })
  const log = Log.create({ service: "workspace-sync" })

  export function startSyncing(project: Project.Info) {
    void (async () => {
      // Discover any untracked worktrees first (opencode parity), then start
      // sync loops for the non-worktree workspaces.
      const spaces = await syncList(project).catch(async (error) => {
        log.warn("workspace syncList failed", { project: project.id, error })
        return list(project)
      })
      for (const space of spaces) {
        if (space.config.type !== "worktree") {
          startSpaceSync(space)
          continue
        }
        const healthy = await Promise.resolve(getAdaptor(space.config).healthCheck?.(space.config)).catch(() => false)
        WorkspaceConnection.set(space.id, healthy === false ? "error" : "connected")
      }
    })()

    return {
      async stop() {
        const spaces = await list(project)
        spaces.forEach((space) => WorkspaceConnection.stop(space.id))
      },
    }
  }

  export function stopAllSyncing() {
    WorkspaceConnection.stopAll()
  }

  export async function statuses(project: Project.Info): Promise<ConnectionStatusInfo[]> {
    return (await list(project)).map((space) => ({
      workspaceID: space.id,
      status: status(space.id),
    }))
  }

  export const JournalEvent = z.object({
    seq: z.number().int(),
    type: z.string(),
    data: z.unknown(),
    timestamp: z.number(),
  })
  export type JournalEvent = z.infer<typeof JournalEvent>

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
      const info = await get(workspaceID)
      if (!info)
        throw new Storage.NotFoundError({
          message: `Workspace not found: ${workspaceID}`,
        })
      const { SyncStorage } = await import("@/sync")
      const records = await SyncStorage.getEvents(info.projectID, workspaceID, from)
      return records.map((record) => ({
        seq: record.seq,
        type: record.type,
        data: record.data,
        timestamp: record.timestamp,
      }))
    },
  )

  // Register process-exit cleanup once per process. The connection module
  // owns the loop state and installs the actual handlers automatically on
  // import; this helper exists for tests that want a no-op re-entry.
  export const registerCleanup = () => {}

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
      const info = await get(workspaceID)
      if (!info)
        throw new Storage.NotFoundError({
          message: `Workspace not found: ${workspaceID}`,
        })
      if (info.config.type === "worktree") {
        WorkspaceConnection.set(workspaceID, "connected")
        return buildRestorePayload(workspaceID)
      }
      startSpaceSync(info)
      const currentStatus = WorkspaceConnection.current(workspaceID)
      if (currentStatus === "connected") return buildRestorePayload(workspaceID)
      if (currentStatus === "error") {
        throw new Error(`Workspace failed to connect: ${workspaceID}`)
      }
      const { EventLoop } = await import("@/util/eventloop")
      const settled = await EventLoop.waitEvent({
        event: Event.Status,
        timeoutMs,
        signal: signal as AbortSignal | undefined,
        predicate: (p) => p.workspaceID === workspaceID && (p.status === "connected" || p.status === "error"),
      })
      if (settled.status !== "connected") {
        throw new Error(`Workspace failed to connect: ${workspaceID}`)
      }
      return buildRestorePayload(workspaceID)
    },
  )

  // Register process-exit cleanup once per process. The connection module
  // owns the loop state and the actual handlers. The actual call is
  // deferred to module-level side-effect to avoid the TDZ on
  // `WorkspaceConnection` during namespace initialization.

  export const sessionRestore = fn(
    z.object({
      workspaceID: Identifier.schema("workspace"),
      sessionID: Identifier.schema("session"),
      timeoutMs: z.number().int().positive().default(30_000),
      signal: z.any().optional(),
    }),
    async ({ workspaceID, sessionID, timeoutMs, signal }) => {
      await restore({ workspaceID, timeoutMs, signal })
      await runSession(
        Effect.gen(function* () {
          const session = yield* Session.Service
          yield* session.update(sessionID, (draft) => {
            draft.workspaceID = workspaceID
          })
        }),
      )
      const payload = await buildRestorePayload(workspaceID)
      return {
        ...payload,
        sessionID,
      }
    },
  )

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
          const session = yield* Session.Service
          return yield* session.getAnyProject(sessionID)
        }),
      )

      if (current.workspaceID) {
        const previous = await get(current.workspaceID)
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
              })
            })
          } else {
            await runSessionPrompt(
              Effect.gen(function* () {
                const prompt = yield* SessionPrompt.Service
                yield* prompt.cancel(sessionID)
              }),
            )
          }
        } else {
          await runSessionPrompt(
            Effect.gen(function* () {
              const prompt = yield* SessionPrompt.Service
              yield* prompt.cancel(sessionID)
            }),
          )
        }
      } else {
        await runSessionPrompt(
          Effect.gen(function* () {
            const prompt = yield* SessionPrompt.Service
            yield* prompt.cancel(sessionID)
          }),
        )
      }

      const target = workspaceID
        ? await restore({ workspaceID, timeoutMs, signal }).then(() => targetWorkspace(workspaceID))
        : undefined

      const sourcePatch =
        copyChanges && current.workspaceID
          ? await workspaceDiffRaw(current.workspaceID, signal as AbortSignal | undefined).catch((error) => {
              log.warn("session warp source patch read failed", {
                workspaceID: current.workspaceID,
                sessionID,
                error,
              })
              return ""
            })
          : ""

      if (sourcePatch) {
        await applyWorkspacePatch({
          workspaceID,
          fallbackDirectory: current.directory,
          patch: sourcePatch,
          signal: signal as AbortSignal | undefined,
        })
      }

      await runSession(
        Effect.gen(function* () {
          const session = yield* Session.Service
          yield* session.update(sessionID, (draft) => {
            draft.workspaceID = workspaceID ?? undefined
          })
        }),
      )

      if (workspaceID && target?.type === "remote") {
        const headers = new Headers(target.headers)
        headers.set("content-type", "application/json")
        headers.set("x-nikcli-workspace", workspaceID)
        const response = await fetch(new URL("/sync/steal", target.url), {
          method: "POST",
          headers,
          body: JSON.stringify({ sessionID }),
          signal,
        })
        if (!response.ok) {
          const body = await response.text().catch(() => "")
          throw new Error(`Failed to warp session into workspace ${workspaceID}: HTTP ${response.status} ${body}`)
        }
      }

      return {
        sessionID,
        workspaceID: workspaceID ?? null,
      }
    },
  )

  async function runVcsInDirectory<A, E>(directory: string, effect: Effect.Effect<A, E, Vcs.Service>) {
    return withInstanceAsync({ directory, init: InstanceBootstrap }, async () => runVcs(effect))
  }

  async function workspaceDiffRaw(workspaceID: string, signal?: AbortSignal) {
    const target = await targetWorkspace(workspaceID)
    if (!target) return ""

    if (target.type === "local") {
      return runVcsInDirectory(
        target.directory,
        Effect.gen(function* () {
          const vcs = yield* Vcs.Service
          return yield* vcs.diffRaw()
        }),
      )
    }

    const response = await fetch(new URL("/vcs/diff/raw", target.url), {
      headers: target.headers,
      signal,
    }).catch((error) => {
      log.warn("workspace diff raw request failed", { workspaceID, error })
      return undefined
    })
    if (!response?.ok) {
      if (response) {
        log.warn("workspace diff raw request failed", {
          workspaceID,
          status: response.status,
          body: await response.text().catch(() => ""),
        })
      }
      return ""
    }
    return response.text()
  }

  async function applyWorkspacePatch(input: {
    workspaceID: string | null
    fallbackDirectory: string
    patch: string
    signal?: AbortSignal
  }) {
    const target = input.workspaceID ? await targetWorkspace(input.workspaceID) : undefined

    if (target?.type === "remote") {
      const headers = new Headers(target.headers)
      headers.set("content-type", "application/json")
      const response = await fetch(new URL("/vcs/apply", target.url), {
        method: "POST",
        headers,
        body: JSON.stringify({ patch: input.patch }),
        signal: input.signal,
      })
      if (!response.ok) {
        const body = await response.text().catch(() => "")
        throw new Vcs.PatchApplyError({
          message: body || `Failed to apply workspace patch: HTTP ${response.status}`,
          reason: "not-clean",
        })
      }
      return
    }

    const directory = target?.type === "local" ? target.directory : input.fallbackDirectory
    await runVcsInDirectory(
      directory,
      Effect.gen(function* () {
        const vcs = yield* Vcs.Service
        return yield* vcs.apply({ patch: input.patch })
      }),
    )
  }

  async function targetWorkspace(workspaceID: string) {
    const info = await get(workspaceID)
    if (!info)
      throw new Storage.NotFoundError({
        message: `Workspace not found: ${workspaceID}`,
      })
    return Workspace.target(info.id)
  }
}
