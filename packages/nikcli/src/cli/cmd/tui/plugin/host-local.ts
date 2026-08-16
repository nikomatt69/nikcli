import { TuiConfig } from "@/config/tui"
import { installPluginInstaller } from "@/plugin/installer"
import { withInstanceAsync } from "@/effect"
import type { PluginConfigInfo, PluginConfigSources, TuiPluginHost } from "@nikcli-ai/tui/plugin/host"

/**
 * The in-process implementation of the plugin host.
 *
 * This is a **host file**: it lives beside `thread.ts` and `worker.ts` in the
 * terminal's directory but is not terminal code, and it stays in
 * `packages/nikcli` when the tree moves. Every operation binds the instance the
 * directory names — the plugin runtime used to do that itself with
 * `withInstanceAsync`, which is exactly the coupling this removes.
 */
// The terminal installs plugins in its own realm, so it wires the installer in
// its own realm too.
installPluginInstaller()

export const localPluginHost: TuiPluginHost = {
  sources: (directory) => withInstanceAsync({ directory }, () => TuiConfig.sources()) as Promise<PluginConfigSources>,
  get: (directory) => withInstanceAsync({ directory }, () => TuiConfig.get()) as Promise<PluginConfigInfo>,
  reload: (directory) => withInstanceAsync({ directory }, () => TuiConfig.reload()) as Promise<PluginConfigInfo>,
  waitForDependencies: (directory) => withInstanceAsync({ directory }, () => TuiConfig.waitForDependencies()),
}
