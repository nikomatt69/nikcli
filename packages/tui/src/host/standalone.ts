import { createNikcliClient } from "@nikcli-ai/sdk/httpapi"
import type { TuiConfig } from "@nikcli-ai/sdk/httpapi"
import type { PluginConfigInfo, TuiPluginHost } from "@tui/plugin/host"

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

export async function startStandaloneTui(options: StandaloneOptions): Promise<void> {
  const client = createNikcliClient({ baseUrl: options.url, directory: options.directory })

  const readConfig = async (): Promise<PluginConfigInfo> =>
    client.tui
      .config()
      .then((result) => (result.data ?? {}) as PluginConfigInfo)
      .catch(() => ({}) as PluginConfigInfo)

  // Asked over the wire, before the renderer exists — legitimate here precisely
  // because the server is already listening, which is not true inside the CLI.
  const tuiConfig = (await readConfig()) as TuiConfig

  const { tui } = await import("@tui/app")
  await tui({
    url: options.url,
    directory: options.directory,
    args: { sessionID: options.sessionID },
    pluginHost: remotePluginHost(readConfig),
    tuiConfig,
  })
}
