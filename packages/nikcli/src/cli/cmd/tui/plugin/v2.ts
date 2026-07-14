import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@nikcli-ai/plugin/tui"
import type { Context, Data, Destination, Route } from "@nikcli-ai/plugin/v2/tui/context"
import type { Definition } from "@nikcli-ai/plugin/v2/tui/plugin"
import { isRecord } from "@/util/record"

const ROUTE_PREFIX = "__nikcli_v2_tui__:"

function routeName(id: string, name: string) {
  return `${ROUTE_PREFIX}${encodeURIComponent(id)}:${encodeURIComponent(name)}`
}

function parseRouteName(value: string) {
  if (!value.startsWith(ROUTE_PREFIX)) return
  const raw = value.slice(ROUTE_PREFIX.length)
  const index = raw.indexOf(":")
  if (index < 0) return
  try {
    return {
      id: decodeURIComponent(raw.slice(0, index)),
      name: decodeURIComponent(raw.slice(index + 1)),
    }
  } catch {
    return
  }
}

function currentRoute(api: TuiPluginApi): Route {
  const current = api.route.current
  if (current.name === "home") return { type: "home" }
  if (current.name === "session" && typeof current.params?.sessionID === "string") {
    return { type: "session", sessionID: current.params.sessionID }
  }

  const parsed = parseRouteName(current.name)
  const params = "params" in current ? current.params : undefined
  return {
    type: "plugin",
    id: parsed?.id ?? current.name,
    name: parsed?.name ?? current.name,
    data: params,
  }
}

function navigate(api: TuiPluginApi, owner: string, destination: Destination) {
  if (destination.type === "home") {
    api.route.navigate("home")
    return
  }
  if (destination.type === "session") {
    api.route.navigate("session", { sessionID: destination.sessionID })
    return
  }

  const id = "id" in destination ? destination.id : owner
  api.route.navigate(routeName(id, destination.name), destination.data)
}

function createData(api: TuiPluginApi): Data {
  return {
    on(type, handler) {
      return api.event.on(type, handler)
    },
    listen(handler) {
      return api.event.listen(handler)
    },
    get ready() {
      return api.state.ready
    },
    get config() {
      return api.state.config
    },
    get provider() {
      return api.state.provider
    },
    get path() {
      return api.state.path
    },
    get vcs() {
      return api.state.vcs
    },
    workspace: api.state.workspace,
    session: api.state.session,
    part(messageID) {
      return api.state.part(messageID)
    },
    lsp() {
      return api.state.lsp()
    },
    mcp() {
      return api.state.mcp()
    },
  }
}

export function adaptV2TuiPlugin(definition: Definition): TuiPlugin {
  return async (api, options) => {
    const pages = new Set<string>()
    const slots = new Set<string>()
    const context: Context = {
      options: options ?? {},
      client: api.client,
      data: createData(api),
      ui: {
        router: {
          register(page) {
            if (!page.name) throw new TypeError(`V2 TUI plugin ${definition.id} registered an empty page name`)
            if (pages.has(page.name)) throw new Error(`Route already registered: ${page.name}`)
            pages.add(page.name)
            const dispose = api.route.register([
              {
                name: routeName(definition.id, page.name),
                render: ({ params }) => page.render({ data: params }),
              },
            ])
            let active = true
            return () => {
              if (!active) return
              active = false
              pages.delete(page.name)
              dispose()
            }
          },
          navigate(destination) {
            navigate(api, definition.id, destination)
          },
          current() {
            return currentRoute(api)
          },
        },
        slot(name, render) {
          if (!name) throw new TypeError(`V2 TUI plugin ${definition.id} registered an empty slot name`)
          if (slots.has(name)) throw new Error(`Slot already registered: ${name}`)
          slots.add(name)
          const plugin = {
            slots: {
              [name](_context: unknown, props: Record<string, unknown>) {
                return render(props)
              },
            },
          } as unknown as Parameters<TuiPluginApi["slots"]["registerDisposable"]>[0]
          const dispose = api.slots.registerDisposable(plugin)
          let active = true
          return () => {
            if (!active) return
            active = false
            slots.delete(name)
            dispose()
          }
        },
      },
    }

    const cleanup = await definition.setup(context)
    if (cleanup !== undefined && typeof cleanup !== "function") {
      throw new TypeError(`V2 TUI plugin ${definition.id} setup() must return a cleanup function or void`)
    }
    if (cleanup) api.lifecycle.onDispose(cleanup)
  }
}

export function readV2TuiPlugin(raw: Record<string, unknown>, spec: string): TuiPluginModule | undefined {
  const value = raw.default
  if (!isRecord(value) || !("setup" in value)) return
  if (typeof value.id !== "string" || !value.id.trim()) {
    throw new TypeError(`V2 TUI plugin ${spec} must define a non-empty id`)
  }
  if (typeof value.setup !== "function") {
    throw new TypeError(`V2 TUI plugin ${spec} has an invalid setup export`)
  }

  const definition = value as unknown as Definition
  return {
    id: definition.id,
    tui: adaptV2TuiPlugin(definition),
  }
}
