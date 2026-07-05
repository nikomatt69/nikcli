/**
 * Browser Use — internal TUI plugin.
 *
 * Mirrors `feature-plugins/loops`: wires the Browser Use Cloud integration
 * (see `src/browser/`) into the TUI as a self-contained plugin instead of a
 * hard-coded command in `app.tsx`. Registers the `/browser` slash command
 * (aliases: `/browser-use`, `/bu`) that opens the Browser Use setup dialog
 * where the API key, default model, and proxy options are managed.
 */
import type { TuiPlugin, TuiPluginModule } from "@nikcli-ai/plugin/tui"
import { DialogBrowserUse } from "@tui/component/dialog-browser-use"

const id = "internal:browser"

const tui: TuiPlugin = async (api) => {
  api.keymap.registerLayer({
    commands: [
      {
        name: "browser.setup",
        title: "Browser Use",
        namespace: "Provider",
        description: "Configure the Browser Use cloud browser agent",
        slashName: "browser",
        slashAliases: ["browser-use", "bu"],
        run() {
          api.ui.dialog.replace(() => <DialogBrowserUse />)
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
