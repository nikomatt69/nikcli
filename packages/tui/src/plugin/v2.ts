/**
 * Adapts a v2 TUI plugin definition onto the legacy `TuiPluginModule` shape the
 * runtime already knows how to register, so v1 and v2 plugins coexist in one
 * process without a second plugin system.
 *
 * `specs/effect-tui/14-plugin-v2-architecture.md`: this now validates the
 * manifest (req 2), refuses an incompatible host (req 2), and gates the context
 * surface on declared capabilities (req 6). The revocable per-generation scope
 * (req 4) is still the legacy runtime's.
 */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@nikcli-ai/plugin/tui"
import type { Context, Destination, Route } from "@nikcli-ai/plugin/v2/tui/context"
import type { Definition } from "@nikcli-ai/plugin/v2/tui/plugin"
import {
  CapabilityDenied,
  Incompatible,
  hasManifest,
  parseManifest,
  type Capability,
  type Manifest,
} from "@nikcli-ai/plugin/v2/manifest"
import { isRecord } from "@nikcli-ai/util/record"
import semver from "semver"

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

/**
 * The versions a v2 manifest can require of this host.
 *
 * Read from the running packages rather than hardcoded, so a dependency bump
 * cannot leave a stale number here that silently accepts an incompatible
 * plugin. `nikcli` is supplied by the caller because the TUI package does not
 * own the product version.
 */
export interface Host {
  readonly nikcli?: string
  readonly effect?: string
  readonly opentui?: string
  readonly node?: string
  /** Capabilities this host can actually supply. Requirement 6. */
  readonly capabilities?: readonly Capability[]
}

/** What the TUI runtime can supply today. The rest of the vocabulary has no surface yet. */
export const TUI_HOST_CAPABILITIES: readonly Capability[] = ["routes", "storage", "http"]

function defaultHost(): Host {
  return {
    node: typeof process !== "undefined" ? process.versions?.node : undefined,
    capabilities: TUI_HOST_CAPABILITIES,
  }
}

/**
 * Refuse a plugin whose manifest asks for a host this is not.
 *
 * A missing host version is not a failure: the host simply cannot answer that
 * requirement, and refusing on "unknown" would make every plugin unloadable in
 * an embedder that does not report its versions. A present-but-unsatisfied
 * version is a hard failure — that is the case the check exists for.
 */
function checkHost(manifest: Manifest, host: Host) {
  const requirements = manifest.hostRequirements
  if (!requirements) return

  for (const key of ["nikcli", "effect", "opentui", "node"] as const) {
    const required = requirements[key]
    if (!required) continue
    const actual = host[key]
    if (!actual) continue
    const coerced = semver.coerce(actual)?.version ?? actual
    if (!semver.validRange(required)) {
      throw new Incompatible({ pluginID: manifest.id, requirement: key, required, actual: coerced })
    }
    if (!semver.satisfies(coerced, required)) {
      throw new Incompatible({ pluginID: manifest.id, requirement: key, required, actual: coerced })
    }
  }
}

/**
 * Refuse a plugin that asks for something this host cannot supply.
 *
 * Checked at load, not at first call: a plugin that declares `scheduler` on a
 * host with no scheduler is broken whether or not it happens to reach that code
 * path, and finding out at load is the difference between a startup error and a
 * mystery three screens in.
 */
function checkCapabilities(manifest: Manifest, host: Host) {
  const supplied = new Set(host.capabilities ?? TUI_HOST_CAPABILITIES)
  for (const capability of manifest.capabilities) {
    if (supplied.has(capability)) continue
    throw new CapabilityDenied({
      pluginID: manifest.id,
      capability,
      reason: `host does not supply "${capability}" (supplies ${[...supplied].join(", ")})`,
    })
  }
}

/**
 * Deny a capability the plugin did not declare.
 *
 * Throws rather than returning a no-op. A stub would let the plugin believe it
 * registered a route; the failure has to reach the author, and the manifest is
 * where they fix it.
 */
function requireCapability(manifest: Manifest | undefined, capability: Capability, pluginID: string) {
  // No manifest means the pre-manifest v2 shape, which predates gating. It gets
  // the whole surface, the same as before, until its author adds a manifest.
  if (!manifest) return
  if (manifest.capabilities.includes(capability)) return
  throw new CapabilityDenied({
    pluginID,
    capability,
    reason: `plugin did not declare the "${capability}" capability in its manifest`,
  })
}

export function adaptV2TuiPlugin(definition: Definition): TuiPlugin {
  const manifest = definition.manifest
  return async (api, options) => {
    const pages = new Set<string>()
    const slots = new Set<string>()
    const context: Context = {
      options: options ?? {},
      get client() {
        requireCapability(manifest, "http", definition.id)
        return api.client
      },
      data: api.data,
      get storage() {
        requireCapability(manifest, "storage", definition.id)
        return api.storage
      },
      ui: {
        router: {
          register(page) {
            requireCapability(manifest, "routes", definition.id)
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
          // Slots register UI surface the same way routes do, so they share the
          // `routes` capability rather than getting one the spec does not name.
          requireCapability(manifest, "routes", definition.id)
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

export function readV2TuiPlugin(raw: Record<string, unknown>, spec: string, host?: Host): TuiPluginModule | undefined {
  const value = raw.default
  if (!isRecord(value) || !("setup" in value)) return
  if (typeof value.id !== "string" || !value.id.trim()) {
    throw new TypeError(`V2 TUI plugin ${spec} must define a non-empty id`)
  }
  if (typeof value.setup !== "function") {
    throw new TypeError(`V2 TUI plugin ${spec} has an invalid setup export`)
  }

  const resolved = host ?? defaultHost()
  let manifest: Manifest | undefined
  if (hasManifest(value)) {
    manifest = parseManifest(value.manifest, spec)
    checkHost(manifest, resolved)
    checkCapabilities(manifest, resolved)
  }

  const definition = { ...(value as unknown as Definition), manifest }
  return {
    // A plugin without a manifest is reported as `legacy:` so diagnostics say
    // which shape is loaded without a second field to carry it. Requirement 11.
    id: manifest ? manifest.id : `legacy:${definition.id}`,
    tui: adaptV2TuiPlugin(definition),
  }
}
