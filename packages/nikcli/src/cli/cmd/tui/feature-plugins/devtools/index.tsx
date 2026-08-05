/**
 * Devtools bar — internal TUI plugin.
 *
 * Mirrors `feature-plugins/math`: the plugin owns the flag and the `/devtools`
 * command, and `app.tsx` mounts {@link ./bar#DevToolsBar} itself. Nothing is
 * sampled until the bar is visible, so the feature costs nothing while off.
 *
 * What it shows and why it is worth having is documented on the bar.
 */
import type { TuiPlugin, TuiPluginModule } from "@nikcli-ai/plugin/tui"
import { readEnabled, writeEnabled } from "./store"

const id = "internal:devtools"

const tui: TuiPlugin = async (api) => {
  api.keymap.registerLayer({
    commands: () => {
      const enabled = readEnabled(api.kv)
      return [
        {
          name: "devtools.toggle",
          title: enabled ? "Devtools bar: on" : "Devtools bar: off",
          namespace: "Appearance",
          description: "Show event loop delay, CPU and memory while the TUI runs",
          slashName: "devtools",
          slashAliases: ["perf", "diag"],
          run() {
            const next = writeEnabled(api.kv, !readEnabled(api.kv))
            api.ui.toast({
              variant: "info",
              message: next
                ? "Devtools bar on — event loop delay, CPU and memory"
                : "Devtools bar off — sampling stopped",
            })
          },
        },
      ]
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
