/**
 * Browser control — internal TUI plugin.
 *
 * Mirrors `feature-plugins/loops`: wires the local browser-control integration
 * (see `src/browser-control/`, backed by `@nikcli-ai/browser-control`) into the
 * TUI as a self-contained plugin instead of a hard-coded command in `app.tsx`.
 * Registers the `/browser` slash command that opens a dialog listing active
 * background browser sessions.
 */
import type { TuiPlugin, TuiPluginModule } from "@nikcli-ai/plugin/tui"
import { DialogBrowserControl } from "@tui/component/dialog-browser-control"

const id = "internal:browser"

const tui: TuiPlugin = async (api) => {
  api.keymap.registerLayer({
    commands: [
      {
        name: "browser.sessions",
        title: "Browser Control",
        namespace: "Tool",
        description: "Inspect and manage active background browser sessions",
        slashName: "browser",
        run() {
          api.ui.dialog.replace(() => <DialogBrowserControl />)
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
