/**
 * Computer Use — internal TUI plugin.
 *
 * Mirrors `feature-plugins/browser`: surfaces the
 * `@nikcli-ai/computer-use` background desktop engine (the way
 * browser-control surfaces Chromium sessions) in the TUI as a self-contained
 * plugin. Registers the `/computer` slash command that probes the host for
 * screenshot/input capabilities and reports what the `computer` tool can do
 * on this machine (and what optional helpers are missing).
 */
import type { TuiPlugin, TuiPluginModule } from "@nikcli-ai/plugin/tui"
import { hostBackend } from "@nikcli-ai/computer-use"

const id = "internal:computer"

const tui: TuiPlugin = async (api) => {
  api.keymap.registerLayer({
    commands: [
      {
        name: "computer.capabilities",
        title: "Computer Use",
        namespace: "System",
        description: "Check desktop screenshot & input capabilities for the computer tool",
        slashName: "computer",
        slashAliases: ["computer-use"],
        async run() {
          try {
            const caps = await hostBackend.capabilities()
            const Alert = api.ui.DialogAlert
            const lines = [
              `Platform: ${caps.platform}`,
              `Screenshot: ${caps.screenshot ? "available" : "unavailable"}`,
              `Input: ${caps.input ? "available" : "unavailable"}`,
              caps.detail,
            ]
            api.ui.dialog.replace(() => <Alert title="Computer Use" message={lines.join("\n")} />)
          } catch (error) {
            api.ui.toast({
              message: error instanceof Error ? error.message : "Computer capability check failed",
              variant: "error",
              duration: 5000,
            })
          }
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
