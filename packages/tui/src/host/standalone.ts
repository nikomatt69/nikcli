import { ClientError, createNikcliClient } from "@nikcli-ai/sdk/httpapi"
import type { NikcliClient, TuiConfig } from "@nikcli-ai/sdk/httpapi"
import { Log } from "@nikcli-ai/util/log"
import type { PluginConfigInfo, TuiPluginHost } from "@tui/plugin/host"

const log = Log.create({ service: "tui.standalone" })

/**
 * A terminal client with no backend behind it.
 *
 * This is the package's second consumer, and it exists to make "extracted" a
 * fact rather than a claim: it starts the real TUI against a nikcli server
 * reachable over HTTP, importing nothing from `packages/nikcli`. If a backend
 * chain ever creeps back into the terminal's module graph, this is the host
 * that stops building — the CLI's own entry points would keep working, because
 * they have the backend anyway.
 *
 * Two things it deliberately does without, and both are honest limits rather
 * than stubs:
 *
 * - **No external plugins.** The plugin runtime needs the config *surface* —
 *   which files to watch, when a dependency install finished — and that is
 *   local filesystem work the CLI host does. A client attached to someone
 *   else's server has no such surface, so it reports none and loads only the
 *   internal plugins.
 * - **No local config read.** `tui()` takes the renderer config as a prop
 *   because it is needed before any transport exists — but here the transport
 *   is an HTTP server that is *already listening*, so it can simply be asked.
 */
export type StandaloneOptions = {
  /** Base URL of a running nikcli server, e.g. `http://localhost:4096`. */
  url: string
  /** Continue an existing session instead of starting a new one. */
  sessionID?: string
  /** Project directory the server should bind the session to. */
  directory?: string
}

/**
 * A plugin host for a terminal that owns no config files.
 *
 * `sources` returning nothing is what disables the watcher: with no files and
 * no directories there is nothing to reload, which is the correct answer here,
 * not a degraded one.
 */
export function remotePluginHost(read: () => Promise<PluginConfigInfo>): TuiPluginHost {
  return {
    sources: async () => ({ files: [], directories: [] }),
    get: () => read(),
    reload: () => read(),
    waitForDependencies: async () => {},
  }
}

/** Why the server could not supply a usable TUI config. */
export type StandaloneConfigFailure = "unauthorized" | "unavailable" | "malformed"

/**
 * A remote TUI config that could not be read.
 *
 * A 401, an unreachable server and a body this client cannot decode are three
 * different problems, and none of them means "the user has an empty config".
 * Returning `{}` for all three started the renderer on defaults that silently
 * disagreed with the server.
 */
export class StandaloneConfigError extends Error {
  override readonly name = "StandaloneConfigError"
  constructor(
    readonly reason: StandaloneConfigFailure,
    readonly url: string,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(describe(reason, url, status), options)
  }
}

function describe(reason: StandaloneConfigFailure, url: string, status?: number): string {
  const code = status === undefined ? "" : ` (HTTP ${status})`
  if (reason === "unauthorized") return `the nikcli server at ${url} rejected this client${code}`
  if (reason === "unavailable") return `could not reach a nikcli server at ${url}`
  return `the nikcli server at ${url} returned a TUI config this client cannot read${code}`
}

export function classifyConfigFailure(error: unknown, status?: number): StandaloneConfigFailure {
  if (status === 401 || status === 403) return "unauthorized"
  if (error instanceof ClientError) {
    if (error.reason === "Transport") return "unavailable"
    return "malformed"
  }
  return status === undefined ? "unavailable" : "malformed"
}

type ConfigResult = Awaited<ReturnType<NikcliClient["tui"]["config"]>>
type ConfigClient = { readonly tui: { readonly config: () => Promise<ConfigResult> } }

/**
 * Read the TUI config from a running server, or fail with a reason the caller
 * can act on. A successful response is used as-is, including an empty one —
 * only a *failure* is refused.
 */
export async function readRemoteTuiConfig(client: ConfigClient, url: string): Promise<PluginConfigInfo> {
  let result: ConfigResult
  try {
    result = await client.tui.config()
  } catch (error) {
    throw new StandaloneConfigError(classifyConfigFailure(error), url, undefined, { cause: error })
  }
  if (result.error !== undefined) {
    const status = result.response?.status
    throw new StandaloneConfigError(classifyConfigFailure(result.error, status), url, status, { cause: result.error })
  }
  return (result.data ?? {}) as PluginConfigInfo
}

export async function startStandaloneTui(options: StandaloneOptions): Promise<void> {
  const client = createNikcliClient({ baseUrl: options.url, directory: options.directory })

  // Asked over the wire, before the renderer exists — legitimate here precisely
  // because the server is already listening, which is not true inside the CLI.
  // A failure here is fatal: there is no local config to fall back to.
  const tuiConfig = (await readRemoteTuiConfig(client, options.url)) as TuiConfig

  // Reload runs while the renderer owns the terminal, so a failure must not
  // take the session down — but it must not read as an empty config either.
  // Keep the last config the server actually supplied and say what broke.
  let lastGood = tuiConfig as PluginConfigInfo
  const reloadConfig = async (): Promise<PluginConfigInfo> => {
    try {
      lastGood = await readRemoteTuiConfig(client, options.url)
    } catch (error) {
      log.error("tui config reload failed; keeping the last config the server supplied", {
        url: options.url,
        reason: error instanceof StandaloneConfigError ? error.reason : "unknown",
      })
    }
    return lastGood
  }

  const { tui } = await import("@tui/app")
  await tui({
    url: options.url,
    directory: options.directory,
    args: { sessionID: options.sessionID },
    pluginHost: remotePluginHost(reloadConfig),
    tuiConfig,
  })
}
