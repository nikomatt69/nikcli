import type { TuiConfig as TuiConfigContract } from "@nikcli-ai/sdk/httpapi"

/**
 * The config-surface operations the plugin runtime cannot perform itself.
 *
 * Reading the merged TUI config is `GET /tui/config`, and the runtime uses that
 * everywhere it only needs values. These four are different: they *act* on the
 * config surface — enumerate the files to watch, force a re-read after one
 * changes, wait for a plugin's dependencies to finish installing — and each is
 * bound to a project directory. That is host work, and it is inverted the way
 * `upgradeNow` and `startServer` already are: `thread.ts` supplies them, and
 * this module never learns which backend answers.
 *
 * Every operation takes its directory rather than running inside an ambient
 * instance context, which is what let `@/effect` leave the terminal.
 */
export type PluginConfigMeta = {
  scope: "global" | "local"
  source: string
}

/** The merged document, as the contract describes it. */
export type PluginConfigInfo = TuiConfigContract & {
  plugin_meta?: Record<string, PluginConfigMeta>
}

export type PluginConfigSources = {
  files: string[]
  directories: string[]
}

export type TuiPluginHost = {
  /** Config files and plugin directories the current snapshot was built from. */
  sources(directory: string): Promise<PluginConfigSources>
  /** The merged document for this directory. */
  get(directory: string): Promise<PluginConfigInfo>
  /** Re-read from disk and replace the cached snapshot. */
  reload(directory: string): Promise<PluginConfigInfo>
  /** Resolve once every pending plugin dependency install has settled. */
  waitForDependencies(directory: string): Promise<void>
}

let host: TuiPluginHost | undefined

/**
 * Installed once by `app.tsx` from the props `thread.ts` passes to `tui()`.
 *
 * Unset is a programming error rather than a degraded mode: a terminal with no
 * host cannot watch the config surface at all, and failing loudly here beats a
 * plugin list that silently stops reconciling.
 */
export function setPluginHost(next: TuiPluginHost): void {
  host = next
}

export function pluginHost(): TuiPluginHost {
  if (!host) throw new Error("TuiPluginRuntime used before its host was installed")
  return host
}
