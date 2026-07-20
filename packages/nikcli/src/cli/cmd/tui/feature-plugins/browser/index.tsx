/**
 * Browser — internal TUI plugin.
 *
 * Mirrors `feature-plugins/loops`: wires the local browser-control integration
 * (see `src/browser/`, backed by `@nikcli-ai/browser-control`) into the TUI as
 * a self-contained plugin instead of a hard-coded command in `app.tsx`.
 * Registers the `/browser` slash command that opens a dialog listing active
 * background browser sessions.
 */
import type { TuiPlugin, TuiPluginModule } from "@nikcli-ai/plugin/tui"
import { DialogBrowserUse } from "@tui/component/dialog-browser-use"

const id = "internal:browser"

const tui: TuiPlugin = async (api) => {
  api.keymap.registerLayer({
    commands: [
      {
        name: "browser.sessions",
        title: "Browser",
        namespace: "Tool",
        description: "Inspect and manage active background browser sessions",
        slashName: "browser",
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
