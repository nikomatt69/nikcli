/**
 * nikcli Herdr — internal TUI plugin.
 *
 * Surfaces the server-side Herdr bridge (`@nikcli-ai/util/herdr-bridge`)
 * as a toggleable plugin, exactly the way the Island plugin wraps its
 * bridge. The plugin is loaded unconditionally, but the bridge stays
 * dormant until the user toggles it on — keeping nikcli totally silent on
 * machines without herdr installed, and never reporting phantom agents
 * when the user is just exploring the TUI.
 *
 * Registers:
 *   - `/herdr` slash command (aliases: `/herdr-status`, `/herdr-connect`)
 *     that opens the status dialog.
 *   - `herdr.toggle` (also dispatchable from the command palette) that
 *     flips the bridge on/off.
 *   - `herdr.refresh` that pulls a fresh snapshot and repaints the dialog.
 */
import { HerdrBridge } from "@nikcli-ai/util/herdr-bridge"
import type { HerdrSnapshot } from "@nikcli-ai/util/herdr-bridge"
import { DialogHerdrStatus } from "./dialog"
import type { TuiPlugin, TuiPluginModule } from "@nikcli-ai/plugin/tui"

const id = "internal:herdr"

const tui: TuiPlugin = async (api) => {
  // Auto-enable when running inside a Herdr pane so the agent appears
  // as a first-class herdr agent without the user flipping a toggle.
  // Outside a Herdr pane, the bridge stays dormant — the user can flip
  // it on via `herdr.toggle` if they want a manual integration.
  if (HerdrBridge.isInHerdrPane() && !HerdrBridge.isEnabled()) {
    HerdrBridge.setEnabled(true)
    api.ui.toast({
      variant: "info",
      message: "Running inside Herdr pane; bridge auto-enabled",
      duration: 4000,
    })
  }

  api.keymap.registerLayer({
    commands: [
      {
        name: "herdr.status",
        title: "Herdr status",
        namespace: "Integrations",
        description: "Check the Herdr bridge status and inspect workspaces/agents",
        slashName: "herdr",
        slashAliases: ["herdr-status", "herdr-connect"],
        run() {
          api.ui.dialog.replace(() => <DialogHerdrStatus />)
        },
      },
      {
        name: "herdr.toggle",
        title: "Herdr bridge",
        namespace: "Integrations",
        description: "Toggle the bridge that reports nikcli sessions to a running Herdr server",
        run() {
          const next = !HerdrBridge.isEnabled()
          HerdrBridge.setEnabled(next)
          api.ui.toast({
            variant: next ? "success" : "info",
            message: next ? "Herdr bridge enabled" : "Herdr bridge disabled",
            duration: 3000,
          })
        },
      },
      {
        name: "herdr.refresh",
        title: "Herdr refresh snapshot",
        namespace: "Integrations",
        description: "Pull a fresh Herdr session snapshot and cache it for the TUI",
        run() {
          HerdrBridge.refresh(api.state.path.directory || process.cwd())
            .then((snap: HerdrSnapshot) => {
              api.ui.toast({
                variant: "success",
                message: `Herdr snapshot: ${snap.workspaces.length} workspaces, ${snap.panes.length} panes`,
                duration: 3000,
              })
            })
            .catch((error: unknown) => {
              api.ui.toast({
                variant: "error",
                message: error instanceof Error ? error.message : "Herdr refresh failed",
                duration: 5000,
              })
            })
        },
      },
    ],
  })

  // Best-effort: warm up the snapshot at startup so the status dialog has
  // fresh data ready if the user opens it within the first few seconds.
  // Fire-and-forget so a slow / missing herdr server never blocks the TUI.
  setTimeout(() => {
    HerdrBridge.refresh(api.state.path.directory || process.cwd()).catch(() => {})
  }, 1500)
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
