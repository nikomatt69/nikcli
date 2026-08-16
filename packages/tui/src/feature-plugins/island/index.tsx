/**
 * nikcli Island — internal TUI plugin.
 *
 * Surfaces the macOS notch companion app (`packages/nikcli-island`, driven by
 * `@nikcli-ai/util/island-bridge`) as a toggleable plugin, the same way
 * Computer/Browser wrap their own backing drivers. The plugin is loaded only
 * when the CLI is started with `--island`; activating it turns the bridge on for the current
 * session; deactivating it via the Plugin Manager clears this session's
 * snapshot and stops writing until re-enabled — the toggle persists like any
 * other plugin's enabled state. Non-TUI entrypoints (`nikcli run`, `serve`)
 * aren't affected by this toggle: they self-activate through `Bus.publish`
 * independently, gated by `--island` and `NIKCLI_ISLAND_DISABLE`.
 */
import { IslandBridge } from "@nikcli-ai/util/island-bridge"
import type { TuiPlugin, TuiPluginModule } from "@nikcli-ai/plugin/tui"

const id = "internal:island"

const tui: TuiPlugin = async (api) => {
  IslandBridge.setEnabled(true)
  api.lifecycle.onDispose(() => {
    IslandBridge.setEnabled(false)
  })

  api.keymap.registerLayer({
    commands: [
      {
        name: "island.status",
        title: "nikcli Island",
        namespace: "System",
        description: "Check the macOS notch companion app bridge status",
        slashName: "island",
        run() {
          void (async () => {
            const status = await IslandBridge.status()
            const Alert = api.ui.DialogAlert
            const lines = status.supported
              ? [
                  `Bridge: ${status.enabled ? "enabled" : "disabled"}`,
                  `App running: ${status.appRunning ? "yes" : "no"}`,
                  `Live sessions: ${status.sessions}`,
                ]
              : ["nikcli Island is macOS-only; unavailable on this platform."]
            api.ui.dialog.replace(() => <Alert title="nikcli Island" message={lines.join("\n")} />)
          })().catch((error) => {
            api.ui.toast({
              message: error instanceof Error ? error.message : "Island status check failed",
              variant: "error",
              duration: 5000,
            })
          })
        },
      },
    ],
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
