import type {
  Agent,
  Command,
  ConnectorStatus,
  McpResource,
  McpStatus,
  Model,
  PermissionRequest,
  PermissionRule,
  Provider,
  Pty,
  QuestionRequest,
  ReferenceConfig,
  SessionEntry,
} from "@nikcli-ai/sdk/httpapi"
import type {
  Data,
  IntegrationInfo,
  LocationRef,
  McpServer,
  ReferenceInfo,
  SessionEntryInfo,
  SessionMessageInfo,
  SessionPendingInfo,
  SkillInfo,
} from "@nikcli-ai/plugin/v2/tui/context"
import type { useSDK } from "@tui/context/sdk"
import type { useRoute } from "@tui/context/route"
import type { useSync } from "@tui/context/sync"
import { createStore, produce, reconcile } from "solid-js/store"

type Input = {
  sdk: ReturnType<typeof useSDK>
  route: ReturnType<typeof useRoute>
  sync: ReturnType<typeof useSync>
}

type LocationData = {
  agent?: Agent[]
  command?: Command[]
  integration?: IntegrationInfo[]
  mcpServer?: McpServer[]
  mcpResource?: McpResource[]
  model?: Model[]
  provider?: Provider[]
  reference?: ReferenceInfo[]
  skill?: SkillInfo[]
  shell?: Pty[]
}

/** A live v2 entry — flat, discriminated on `type` (see session/v2/entry.ts). */
type PendingEntry = SessionEntry

function locationKey(location: LocationRef) {
  return `${location.directory}\u0000${location.workspaceID ?? ""}`
}

function query(location: LocationRef) {
  return {
    directory: location.directory,
    workspace: location.workspaceID,
  }
}

/**
 * `config.reference` comes back untyped — the contract still carries the whole
 * `nikcli.json` document as an open record — so the entries are narrowed here.
 */
function references(value: unknown): ReferenceInfo[] {
  if (typeof value !== "object" || value === null) return []
  return Object.entries(value as Record<string, ReferenceConfig>).map(([name, reference]) => ({ ...reference, name }))
}

function permissionKey(rule: PermissionRule) {
  return `${rule.permission}\u0000${rule.pattern}\u0000${rule.action}`
}

export function createV2Data(input: Input): Data {
  const [locations, setLocations] = createStore<Record<string, LocationData>>({})
  const [pending, setPending] = createStore<Record<string, SessionPendingInfo[]>>({})
  const [forms, setForms] = createStore<Record<string, Array<QuestionRequest & { readonly location?: LocationRef }>>>(
    {},
  )
  const [projectPermissions, setProjectPermissions] = createStore<Record<string, PermissionRule[]>>({})

  function defaultLocation(): LocationRef {
    const current = input.sync.data.path.directory || input.sdk.directory || ""
    return { directory: current, workspaceID: input.route.data.workspaceID }
  }

  function resolveLocation(location?: LocationRef) {
    return location ?? defaultLocation()
  }

  function isDefault(location: LocationRef) {
    return locationKey(location) === locationKey(defaultLocation())
  }

  function cached(location?: LocationRef) {
    return locations[locationKey(resolveLocation(location))]
  }

  function messages(sessionID: string): SessionMessageInfo[] {
    return (input.sync.data.message[sessionID] ?? []).map((info) => ({
      info,
      parts: input.sync.data.part[info.id] ?? [],
    }))
  }

  function resolveRoot(sessionID: string) {
    const seen = new Set<string>()
    let current = sessionID
    while (!seen.has(current)) {
      seen.add(current)
      const parent = input.sync.session.get(current)?.parentID
      if (!parent) return current
      current = parent
    }
    return sessionID
  }

  function family(sessionID: string) {
    const root = resolveRoot(sessionID)
    return input.sync.data.session.filter((session) => resolveRoot(session.id) === root).map((session) => session.id)
  }

  function ownCost(sessionID: string) {
    return (input.sync.data.message[sessionID] ?? []).reduce((total, message) => {
      if (message.role !== "assistant") return total
      return total + message.cost
    }, 0)
  }

  function defaultPermissions(projectID: string) {
    const seen = new Set<string>()
    const result: PermissionRule[] = []
    for (const session of input.sync.data.session) {
      if (session.projectID !== projectID) continue
      for (const rule of session.permission ?? []) {
        const key = permissionKey(rule)
        if (seen.has(key)) continue
        seen.add(key)
        result.push(rule)
      }
    }
    return result
  }

  async function refreshMessages(sessionID: string) {
    const response = await input.sdk.client.session.messages({ sessionID }, { throwOnError: true })
    const items = response.data ?? []
    input.sync.set("message", sessionID, reconcile(items.map((item) => item.info)))
    input.sync.set(
      produce((draft) => {
        for (const item of items) draft.part[item.info.id] = item.parts
      }),
    )
  }

  async function refreshPermissions(location?: LocationRef) {
    const ref = resolveLocation(location)
    const response = await input.sdk.client.permission.list(query(ref), { throwOnError: true })
    if (!isDefault(ref)) return response.data ?? []
    const grouped = (response.data ?? []).reduce<Record<string, PermissionRequest[]>>((result, request) => {
      ;(result[request.sessionID] ??= []).push(request)
      return result
    }, {})
    input.sync.set("permission", reconcile(grouped))
    return response.data ?? []
  }

  async function refreshForms(location?: LocationRef) {
    const ref = resolveLocation(location)
    const response = await input.sdk.client.question.list(query(ref), { throwOnError: true })
    const key = locationKey(ref)
    const tagged = (response.data ?? []).map((form) => ({ ...form, location: ref }))
    setForms(key, reconcile(tagged))
    if (isDefault(ref)) {
      const grouped = tagged.reduce<Record<string, QuestionRequest[]>>((result, request) => {
        ;(result[request.sessionID] ??= []).push(request)
        return result
      }, {})
      input.sync.set("question", reconcile(grouped))
    }
    return tagged
  }

  function collection<Value>(
    readDefault: () => Value[] | undefined,
    field: keyof LocationData,
    refresh: (location: LocationRef) => Promise<Value[]>,
  ) {
    return {
      list(location?: LocationRef) {
        const ref = resolveLocation(location)
        if (isDefault(ref)) return readDefault() ?? (cached(ref)?.[field] as Value[] | undefined)
        return cached(ref)?.[field] as Value[] | undefined
      },
      async refresh(location?: LocationRef) {
        const ref = resolveLocation(location)
        const values = await refresh(ref)
        setLocations(locationKey(ref), field, reconcile(values) as never)
      },
    }
  }

  const result: Data = {
    on(type, handler) {
      return input.sdk.event.on(type, handler)
    },
    listen(handler) {
      return input.sdk.onEnvelope((event) => handler({ details: event.payload }))
    },
    session: {
      list() {
        return input.sync.data.session.toSorted((a, b) => b.time.updated - a.time.updated)
      },
      get(sessionID) {
        return input.sync.session.get(sessionID)
      },
      root: resolveRoot,
      family,
      cost(sessionID) {
        const session = input.sync.session.get(sessionID)
        if (!session) return 0
        if (session.parentID) return ownCost(sessionID)
        return family(sessionID).reduce((total, id) => total + ownCost(id), 0)
      },
      status(sessionID) {
        return input.sync.session.status(sessionID) === "idle" ? "idle" : "running"
      },
      pending: {
        list(sessionID) {
          return pending[sessionID] ?? []
        },
        async refresh(sessionID) {
          const response = await input.sdk.client.session.v2.state({ sessionID }, { throwOnError: true })
          const state = response.data as { pending?: PendingEntry[] } | undefined
          setPending(sessionID, reconcile(state?.pending ?? []))
        },
      },
      // Reads the shared sync store rather than a store of its own: that
      // store is kept live by `session.entry.updated`, so a second copy here
      // would go stale the moment anything streamed. `refresh` seeds it, the
      // same way `refreshMessages` seeds `message`/`part`.
      entry: {
        list(sessionID) {
          return input.sync.data.entry[sessionID] ?? []
        },
        async refresh(sessionID) {
          const response = await input.sdk.client.session.v2.entries({ sessionID }, { throwOnError: true })
          input.sync.set("entry", sessionID, reconcile((response.data ?? []) as SessionEntryInfo[]))
        },
      },
      async refresh(sessionID) {
        const response = await input.sdk.client.session.get({ sessionID }, { throwOnError: true })
        if (!response.data) return
        input.sync.set(
          "session",
          reconcile(
            [...input.sync.data.session.filter((session) => session.id !== sessionID), response.data].toSorted((a, b) =>
              a.id.localeCompare(b.id),
            ),
          ),
        )
      },
      message: {
        list: messages,
        get(sessionID, messageID) {
          return messages(sessionID).find((message) => message.info.id === messageID)
        },
        refresh: refreshMessages,
      },
      permission: {
        list(sessionID) {
          return input.sync.data.permission[sessionID]
        },
        async refresh(sessionID) {
          const list = await refreshPermissions()
          input.sync.set("permission", sessionID, reconcile(list.filter((request) => request.sessionID === sessionID)))
        },
      },
      form: {
        list(sessionID, location) {
          if (sessionID !== "global" && !location) return input.sync.data.question[sessionID]
          const ref = resolveLocation(location)
          return (forms[locationKey(ref)] ?? []).filter((form) => form.sessionID === sessionID)
        },
        async refresh(sessionID, location) {
          const list = await refreshForms(location)
          if (sessionID !== "global" && isDefault(resolveLocation(location))) {
            input.sync.set("question", sessionID, reconcile(list.filter((form) => form.sessionID === sessionID)))
          }
        },
      },
    },
    project: {
      permission: {
        list(projectID) {
          return projectPermissions[projectID] ?? defaultPermissions(projectID)
        },
        async refresh(projectID) {
          const response = await input.sdk.client.session.list({}, { throwOnError: true })
          const seen = new Set<string>()
          const permissions: PermissionRule[] = []
          for (const session of response.data ?? []) {
            if (session.projectID !== projectID) continue
            for (const rule of session.permission ?? []) {
              const key = permissionKey(rule)
              if (seen.has(key)) continue
              seen.add(key)
              permissions.push(rule)
            }
          }
          setProjectPermissions(projectID, reconcile(permissions))
        },
      },
    },
    shell: {
      list(location) {
        const ref = resolveLocation(location)
        return cached(ref)?.shell ?? []
      },
      get(id) {
        for (const value of Object.values(locations)) {
          const shell = value.shell?.find((item) => item.id === id)
          if (shell) return shell
        }
        return undefined
      },
      async refresh(location) {
        const ref = resolveLocation(location)
        const response = await input.sdk.client.pty.list(query(ref), { throwOnError: true })
        setLocations(locationKey(ref), "shell", reconcile(response.data ?? []))
      },
    },
    location: {
      default: defaultLocation,
      async refresh(location) {
        const ref = resolveLocation(location)
        const response = await input.sdk.client.path.get(query(ref), { throwOnError: true })
        if (isDefault(ref) && response.data) input.sync.set("path", reconcile(response.data))
        if (!locations[locationKey(ref)]) setLocations(locationKey(ref), {})
      },
      agent: collection(
        () => input.sync.data.agent,
        "agent",
        async (ref) => {
          const response = await input.sdk.client.app.agents(query(ref), { throwOnError: true })
          if (isDefault(ref)) input.sync.set("agent", reconcile(response.data ?? []))
          return response.data ?? []
        },
      ),
      command: collection(
        () => input.sync.data.command,
        "command",
        async (ref) => {
          const response = await input.sdk.client.command.list(query(ref), { throwOnError: true })
          if (isDefault(ref)) input.sync.set("command", reconcile(response.data ?? []))
          return response.data ?? []
        },
      ),
      integration: collection(
        () => Object.entries(input.sync.data.connectors).map(([name, status]) => ({ name, status })),
        "integration",
        async (ref) => {
          const response = await input.sdk.client.connectors.status(query(ref), { throwOnError: true })
          const data = response.data ?? {}
          if (isDefault(ref)) input.sync.set("connectors", reconcile(data))
          return Object.entries(data).map(([name, status]) => ({ name, status: status as ConnectorStatus }))
        },
      ),
      mcp: {
        server: collection(
          () => Object.entries(input.sync.data.mcp).map(([name, status]) => ({ name, status })),
          "mcpServer",
          async (ref) => {
            const response = await input.sdk.client.mcp.status(query(ref), { throwOnError: true })
            const data = response.data ?? {}
            if (isDefault(ref)) input.sync.set("mcp", reconcile(data))
            return Object.entries(data).map(([name, status]) => ({ name, status: status as McpStatus }))
          },
        ),
        resource: collection(
          () => Object.values(input.sync.data.mcp_resource),
          "mcpResource",
          async (ref) => {
            const response = await input.sdk.client.experimental.resource.list(query(ref), { throwOnError: true })
            const data = response.data ?? {}
            if (isDefault(ref)) input.sync.set("mcp_resource", reconcile(data))
            return Object.values(data)
          },
        ),
      },
      model: collection(
        () => input.sync.data.provider.flatMap((provider) => Object.values(provider.models)),
        "model",
        async (ref) => {
          const response = await input.sdk.client.config.providers(query(ref), { throwOnError: true })
          const providers = response.data?.providers ?? []
          if (isDefault(ref)) input.sync.set("provider", reconcile(providers))
          return providers.flatMap((provider) => Object.values(provider.models))
        },
      ),
      provider: collection(
        () => input.sync.data.provider,
        "provider",
        async (ref) => {
          const response = await input.sdk.client.config.providers(query(ref), { throwOnError: true })
          const providers = response.data?.providers ?? []
          if (isDefault(ref)) input.sync.set("provider", reconcile(providers))
          return providers
        },
      ),
      reference: collection(
        () => references(input.sync.data.config.reference),
        "reference",
        async (ref) => {
          const response = await input.sdk.client.config.get(query(ref), { throwOnError: true })
          const config = response.data
          if (isDefault(ref) && config) input.sync.set("config", reconcile(config))
          return references(config?.reference)
        },
      ),
      skill: collection(
        () => undefined,
        "skill",
        async (ref) => {
          const response = await input.sdk.client.app.skills(query(ref), { throwOnError: true })
          return response.data ?? []
        },
      ),
    },
  }

  void Promise.allSettled([
    result.location.refresh(),
    result.location.agent.refresh(),
    result.location.command.refresh(),
    result.location.integration.refresh(),
    result.location.mcp.server.refresh(),
    result.location.mcp.resource.refresh(),
    result.location.model.refresh(),
    result.location.provider.refresh(),
    result.location.reference.refresh(),
    result.location.skill.refresh(),
    result.shell.refresh(),
    refreshPermissions(),
    refreshForms(),
  ])

  return result
}
