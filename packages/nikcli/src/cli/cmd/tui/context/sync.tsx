import type {
  Message,
  Agent,
  Provider,
  Session,
  Part,
  Todo,
  Command,
  PermissionRequest,
  QuestionRequest,
  LspStatus,
  McpStatus,
  McpResource,
  ConnectorStatus,
  FormatterStatus,
  SessionStatus,
  ProviderListResponse,
  ProviderAuthMethod,
  VcsInfo,
  FileDiff,
  Workspace,
} from "@nikcli-ai/sdk/v2"
import type { Config } from "@nikcli-ai/sdk/v2/client"
import { createStore, produce, reconcile } from "solid-js/store"
import { useSDK } from "@tui/context/sdk"
import { Binary } from "@nikcli-ai/util/binary"
import { createSimpleContext } from "./helper"
import { useExit } from "./exit"
import { useArgs } from "./args"
import { batch, onMount } from "solid-js"
import { Log } from "@/util/log"
import type { Path } from "@nikcli-ai/sdk/v2"

type BackgroundJob = {
  jobID: string
  rootDelegationID: string
  parentSessionID: string
  title: string
  agent: string
  status: "running" | "synthesizing" | "complete" | "error" | "timeout" | "cancelled" | "orphaned"
  source?: string
  workerSessionID?: string
  delegatorID?: string
  delegatorSessionID?: string
  createdAt: number
  updatedAt: number
  completedAt?: number
  lastActivityAt?: number
  progressSummary?: string
  resultSummary?: string
  error?: string
}

type MonitorSnapshot = {
  id: string
  title: string
  command: string
  status: "running" | "complete" | "error" | "timeout" | "cancelled" | string
  logPath?: string
  exitCode?: number
  preview?: string
  bytes?: number
}

export const { use: useSync, provider: SyncProvider } = createSimpleContext({
  name: "Sync",
  init: () => {
    const [store, setStore] = createStore<{
      status: "loading" | "partial" | "complete"
      provider: Provider[]
      provider_default: Record<string, string>
      provider_next: ProviderListResponse
      provider_auth: Record<string, ProviderAuthMethod[]>
      agent: Agent[]
      command: Command[]
      config: Config
      permission: Record<string, PermissionRequest[]>
      question: Record<string, QuestionRequest[]>
      session: Session[]
      session_status: Record<string, SessionStatus>
      background_job: Record<string, BackgroundJob[]>
      monitor: Record<string, MonitorSnapshot[]>
      session_diff: Record<string, FileDiff[]>
      todo: Record<string, Todo[]>
      message: Record<string, Message[]>
      part: Record<string, Part[]>
      lsp: LspStatus[]
      mcp: Record<string, McpStatus>
      mcp_resource: Record<string, McpResource>
      connectors: Record<string, ConnectorStatus>
      formatter: FormatterStatus[]
      vcs: VcsInfo | undefined
      path: Path
      workspaceList: Workspace[]
    }>({
      status: "loading",
      provider: [],
      provider_default: {},
      provider_next: { all: [], default: {}, connected: [] },
      provider_auth: {},
      agent: [],
      command: [],
      config: {} as Config,
      permission: {},
      question: {},
      session: [],
      session_status: {},
      background_job: {},
      monitor: {},
      session_diff: {},
      todo: {},
      message: {},
      part: {},
      lsp: [],
      mcp: {},
      mcp_resource: {},
      connectors: {},
      formatter: [],
      vcs: undefined,
      path: { home: "", state: "", config: "", worktree: "", directory: "" },
      workspaceList: [],
    })

    const sdk = useSDK()
    const backgroundRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>()

    async function refreshBackgroundJobs(sessionID: string) {
      const result = await sdk.client.session.background({ sessionID }).catch(() => undefined)
      if (!result?.data) return
      setStore("background_job", sessionID, reconcile(result.data))
    }

    function scheduleBackgroundRefresh(sessionID?: string) {
      if (!sessionID) return
      const existing = backgroundRefreshTimers.get(sessionID)
      if (existing) clearTimeout(existing)
      const timer = setTimeout(() => {
        backgroundRefreshTimers.delete(sessionID)
        void refreshBackgroundJobs(sessionID).catch(() => {})
      }, 75)
      backgroundRefreshTimers.set(sessionID, timer)
    }

    function monitorFromRecord(record: {
      id: string
      title: string
      command: string
      status: MonitorSnapshot["status"]
      logPath: string
      exitCode?: number
      preview?: string
      bytes?: number
    }): MonitorSnapshot {
      return {
        id: record.id,
        title: record.title,
        command: record.command,
        status: record.status,
        logPath: record.logPath,
        exitCode: record.exitCode,
        preview: record.preview,
        bytes: record.bytes,
      }
    }

    function upsertMonitor(sessionID: string, monitor: MonitorSnapshot) {
      const monitors = store.monitor[sessionID]
      if (!monitors) {
        setStore("monitor", sessionID, [monitor])
        return
      }
      const result = Binary.search(monitors, monitor.id, (m) => m.id)
      if (result.found) {
        setStore("monitor", sessionID, result.index, reconcile(monitor))
        return
      }
      setStore(
        "monitor",
        sessionID,
        produce((draft) => {
          draft.splice(result.index, 0, monitor)
        }),
      )
    }

    function patchMonitor(sessionID: string, monitorID: string, patch: Partial<MonitorSnapshot>) {
      const monitors = store.monitor[sessionID]
      if (!monitors) return
      const result = Binary.search(monitors, monitorID, (m) => m.id)
      if (!result.found) return
      setStore("monitor", sessionID, result.index, reconcile({ ...monitors[result.index], ...patch }))
    }

    async function syncWorkspaces() {
      const result = await sdk.client.experimental.workspace.list().catch(() => undefined)
      if (!result?.data) return
      setStore("workspaceList", reconcile(result.data))
    }

    function getSessionByID(sessionID: string) {
      const match = Binary.search(store.session, sessionID, (s) => s.id)
      if (match.found) return store.session[match.index]
      return undefined
    }

    sdk.event.listen((e) => {
      const event = e.details
      switch (event.type) {
        // Note: InstanceDisposed events are handled explicitly by the caller
        // (e.g., ApiMethod, AutoMethod, CodeMethod) to avoid double-bootstrap.
        case "permission.replied": {
          const requests = store.permission[event.properties.sessionID]
          if (!requests) break
          const match = Binary.search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "permission",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "permission.asked": {
          const request = event.properties
          const requests = store.permission[request.sessionID]
          if (!requests) {
            setStore("permission", request.sessionID, [request])
            break
          }
          const match = Binary.search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("permission", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "permission",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "question.replied":
        case "question.rejected": {
          const requests = store.question[event.properties.sessionID]
          if (!requests) break
          const match = Binary.search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "question",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "question.asked": {
          const request = event.properties
          const requests = store.question[request.sessionID]
          if (!requests) {
            setStore("question", request.sessionID, [request])
            break
          }
          const match = Binary.search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("question", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "question",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "todo.updated":
          setStore("todo", event.properties.sessionID, event.properties.todos)
          break

        case "session.diff":
          setStore("session_diff", event.properties.sessionID, event.properties.diff)
          break

        case "session.deleted": {
          syncedSessions.delete(event.properties.info.id)
          const messageIDs = (store.message[event.properties.info.id] ?? []).map((message) => message.id)
          const result = Binary.search(store.session, event.properties.info.id, (s) => s.id)
          if (result.found) {
            setStore(
              "session",
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          setStore(
            produce((draft) => {
              delete draft.message[event.properties.info.id]
              delete draft.todo[event.properties.info.id]
              delete draft.background_job[event.properties.info.id]
              delete draft.monitor[event.properties.info.id]
              delete draft.session_diff[event.properties.info.id]
              delete draft.session_status[event.properties.info.id]
              for (const messageID of messageIDs) {
                delete draft.part[messageID]
              }
            }),
          )
          break
        }
        case "session.updated": {
          const result = Binary.search(store.session, event.properties.info.id, (s) => s.id)
          if (result.found) {
            setStore("session", result.index, reconcile(event.properties.info))
            break
          }
          setStore(
            "session",
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.info)
            }),
          )
          break
        }

        case "session.status": {
          setStore("session_status", event.properties.sessionID, event.properties.status)
          const parentID = getSessionByID(event.properties.sessionID)?.parentID
          scheduleBackgroundRefresh(parentID)
          break
        }

        case "message.updated": {
          const messages = store.message[event.properties.info.sessionID]
          if (!messages) {
            setStore("message", event.properties.info.sessionID, [event.properties.info])
            break
          }
          const result = Binary.search(messages, event.properties.info.id, (m) => m.id)
          if (result.found) {
            setStore("message", event.properties.info.sessionID, result.index, reconcile(event.properties.info))
            break
          }
          setStore(
            "message",
            event.properties.info.sessionID,
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.info)
            }),
          )
          const updated = store.message[event.properties.info.sessionID]
          if (updated.length > 100) {
            const oldest = updated[0]
            batch(() => {
              setStore(
                "message",
                event.properties.info.sessionID,
                produce((draft) => {
                  draft.shift()
                }),
              )
              setStore(
                "part",
                produce((draft) => {
                  delete draft[oldest.id]
                }),
              )
            })
          }
          break
        }
        case "message.removed": {
          const messages = store.message[event.properties.sessionID]
          const result = Binary.search(messages, event.properties.messageID, (m) => m.id)
          if (result.found) {
            setStore(
              "message",
              event.properties.sessionID,
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          break
        }
        case "message.part.updated": {
          const refreshParentID = getSessionByID(event.properties.part.sessionID)?.parentID
          const parts = store.part[event.properties.part.messageID]
          if (!parts) {
            setStore("part", event.properties.part.messageID, [event.properties.part])
            scheduleBackgroundRefresh(refreshParentID)
            if (event.properties.part.type === "tool" && event.properties.part.tool === "task") {
              scheduleBackgroundRefresh(event.properties.part.sessionID)
            }
            break
          }
          const result = Binary.search(parts, event.properties.part.id, (p) => p.id)
          if (result.found) {
            setStore("part", event.properties.part.messageID, result.index, reconcile(event.properties.part))
            if (event.properties.part.type === "tool" && event.properties.part.tool === "task") {
              scheduleBackgroundRefresh(refreshParentID)
              scheduleBackgroundRefresh(event.properties.part.sessionID)
            }
            break
          }
          setStore(
            "part",
            event.properties.part.messageID,
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.part)
            }),
          )
          scheduleBackgroundRefresh(refreshParentID)
          if (event.properties.part.type === "tool" && event.properties.part.tool === "task") {
            scheduleBackgroundRefresh(event.properties.part.sessionID)
          }
          break
        }

        case "delegation.completed": {
          scheduleBackgroundRefresh(event.properties.parentSessionID)
          break
        }

        case "monitor.created": {
          upsertMonitor(event.properties.sessionID, monitorFromRecord(event.properties.record))
          break
        }

        case "monitor.updated": {
          upsertMonitor(event.properties.sessionID, monitorFromRecord(event.properties.record))
          break
        }

        case "monitor.output": {
          patchMonitor(event.properties.sessionID, event.properties.monitorID, {
            preview: event.properties.preview,
            bytes: event.properties.bytes,
            status: event.properties.status,
          })
          break
        }

        case "monitor.completed": {
          patchMonitor(event.properties.sessionID, event.properties.monitorID, {
            title: event.properties.title,
            status: event.properties.status,
            exitCode: event.properties.exitCode ?? undefined,
            logPath: event.properties.logPath,
          })
          break
        }

        case "message.part.removed": {
          const parts = store.part[event.properties.messageID]
          const result = Binary.search(parts, event.properties.partID, (p) => p.id)
          if (result.found)
            setStore(
              "part",
              event.properties.messageID,
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          break
        }

        case "lsp.updated": {
          void sdk.client.lsp
            .status()
            .then((x) => setStore("lsp", x.data!))
            .catch(() => {})
          break
        }

        case "vcs.branch.updated": {
          setStore("vcs", { branch: event.properties.branch })
          break
        }
      }
    })

    const { exit } = useExit()
    const args = useArgs()

    async function refreshProviders() {
      // Refresh provider data without clearing session state
      const [providerList, providerNext, providerAuth] = await Promise.all([
        sdk.client.config.providers({}, { throwOnError: true }),
        sdk.client.provider.list({}, { throwOnError: true }),
        sdk.client.provider.auth(),
      ])
      batch(() => {
        setStore("provider", reconcile(providerList.data!.providers))
        setStore("provider_default", reconcile(providerList.data!.default))
        setStore("provider_next", reconcile(providerNext.data!))
        setStore("provider_auth", reconcile(providerAuth.data ?? {}))
      })
    }

    async function bootstrap() {
      syncedSessions.clear()
      setStore(
        produce((draft) => {
          draft.message = {}
          draft.part = {}
          draft.todo = {}
          draft.background_job = {}
          draft.monitor = {}
          draft.session_diff = {}
          draft.session_status = {}
        }),
      )
      const start = Date.now() - 30 * 24 * 60 * 60 * 1000
      const sessionListPromise = sdk.client.session
        .list({ start: start })
        .then((x) => setStore("session", reconcile((x.data ?? []).toSorted((a, b) => a.id.localeCompare(b.id)))))

      // blocking - include session.list when continuing a session
      const blockingRequests: Promise<unknown>[] = [
        sdk.client.config.providers({}, { throwOnError: true }).then((x) => {
          batch(() => {
            setStore("provider", reconcile(x.data!.providers))
            setStore("provider_default", reconcile(x.data!.default))
          })
        }),
        sdk.client.provider.list({}, { throwOnError: true }).then((x) => {
          batch(() => {
            setStore("provider_next", reconcile(x.data!))
          })
        }),
        sdk.client.app.agents({}, { throwOnError: true }).then((x) => setStore("agent", reconcile(x.data ?? []))),
        sdk.client.config.get({}, { throwOnError: true }).then((x) => setStore("config", reconcile(x.data!))),
        ...(args.continue ? [sessionListPromise] : []),
      ]

      await Promise.all(blockingRequests)
        .then(() => {
          if (store.status !== "complete") setStore("status", "partial")
          // non-blocking
          Promise.all([
            ...(args.continue ? [] : [sessionListPromise]),
            sdk.client.command.list().then((x) => setStore("command", reconcile(x.data ?? []))),
            sdk.client.lsp.status().then((x) => setStore("lsp", reconcile(x.data!))),
            sdk.client.mcp.status().then((x) => setStore("mcp", reconcile(x.data!))),
            sdk.client.experimental.resource.list().then((x) => setStore("mcp_resource", reconcile(x.data ?? {}))),
            sdk.client.connectors.status().then((x) => setStore("connectors", reconcile(x.data!))),
            sdk.client.formatter.status().then((x) => setStore("formatter", reconcile(x.data!))),
            sdk.client.session.status().then((x) => {
              setStore("session_status", reconcile(x.data!))
            }),
            sdk.client.provider.auth().then((x) => setStore("provider_auth", reconcile(x.data ?? {}))),
            sdk.client.vcs.get().then((x) => setStore("vcs", reconcile(x.data))),
            sdk.client.path.get().then((x) => setStore("path", reconcile(x.data!))),
            syncWorkspaces(),
          ])
            .then(() => {
              setStore("status", "complete")
            })
            .catch((e) => {
              Log.Default.warn("tui bootstrap non-blocking refresh failed", {
                error: e instanceof Error ? e.message : String(e),
                name: e instanceof Error ? e.name : undefined,
              })
              if (store.status !== "complete") setStore("status", "partial")
            })
        })
        .catch(async (e) => {
          Log.Default.error("tui bootstrap failed", {
            error: e instanceof Error ? e.message : String(e),
            name: e instanceof Error ? e.name : undefined,
            stack: e instanceof Error ? e.stack : undefined,
          })
          await exit(e)
        })
    }

    onMount(() => {
      bootstrap()
    })

    const syncedSessions = new Map<string, "partial" | "full">()
    const result = {
      data: store,
      set: setStore,
      get status() {
        return store.status
      },
      get ready() {
        return store.status !== "loading"
      },
      session: {
        get(sessionID: string) {
          const match = Binary.search(store.session, sessionID, (s) => s.id)
          if (match.found) return store.session[match.index]
          return undefined
        },
        status(sessionID: string) {
          const session = result.session.get(sessionID)
          if (!session) return "idle"
          if (session.time.compacting) return "compacting"
          const messages = store.message[sessionID] ?? []
          const last = messages.at(-1)
          if (!last) return "idle"
          if (last.role === "user") return "working"
          return last.time.completed ? "idle" : "working"
        },
        async sync(sessionID: string, options?: { full?: boolean }) {
          const mode = options?.full ? "full" : "partial"
          const existing = syncedSessions.get(sessionID)
          if (existing === "full" || existing === mode) return result.session.get(sessionID)
          const [session, messages, todo, diff, backgroundJobs] = await Promise.all([
            sdk.client.session.get({ sessionID }, { throwOnError: true }),
            sdk.client.session.messages(options?.full ? { sessionID } : { sessionID, limit: 100 }),
            sdk.client.session.todo({ sessionID }),
            sdk.client.session.diff({ sessionID }),
            sdk.client.session.background({ sessionID }).catch(() => undefined),
          ])
          setStore(
            produce((draft) => {
              const match = Binary.search(draft.session, sessionID, (s) => s.id)
              if (match.found) draft.session[match.index] = session.data!
              if (!match.found) draft.session.splice(match.index, 0, session.data!)
              draft.todo[sessionID] = todo.data ?? []
              draft.background_job[sessionID] = backgroundJobs?.data ?? []
              draft.message[sessionID] = messages.data!.map((x) => x.info)
              for (const message of messages.data!) {
                draft.part[message.info.id] = message.parts
              }
              draft.session_diff[sessionID] = diff.data ?? []
            }),
          )
          syncedSessions.set(sessionID, mode === "full" ? "full" : "partial")
          return session.data
        },
        async refreshDiff(sessionID: string) {
          if (!sessionID) return []
          const diff = await sdk.client.session.diff({ sessionID })
          const files = diff.data ?? []
          setStore("session_diff", sessionID, files)
          return files
        },
      },
      background: {
        list(sessionID: string) {
          return store.background_job[sessionID] ?? []
        },
        get(sessionID: string, delegationID: string) {
          return (store.background_job[sessionID] ?? []).find((job) => job.rootDelegationID === delegationID)
        },
        findBySession(sessionID: string) {
          for (const jobs of Object.values(store.background_job)) {
            const match = jobs.find((job) => job.workerSessionID === sessionID || job.delegatorSessionID === sessionID)
            if (match) return match
          }
          return undefined
        },
        sync: refreshBackgroundJobs,
      },
      workspace: {
        get(workspaceID: string) {
          return store.workspaceList.find((workspace) => workspace.id === workspaceID)
        },
        sync: syncWorkspaces,
      },
      bootstrap,
      refreshProviders,
    }
    return result
  },
})
