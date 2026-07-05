/**
 * Brain — internal TUI plugin.
 *
 * Mirrors `feature-plugins/loops`: wires the Brain consolidation engine (see
 * `src/brain/`) into the TUI as a self-contained plugin instead of hard-coded
 * calls in `app.tsx`. On activation it arms the background scheduler that
 * periodically consolidates sessions, and it registers the `/brain` slash
 * command that triggers a consolidation pass on demand and navigates to the
 * resulting Brain session.
 */
import type { TuiPlugin, TuiPluginModule } from "@nikcli-ai/plugin/tui"
import { withInstanceAsync } from "@/effect"
import { initBrainScheduler } from "@/brain/scheduler"

const id = "internal:brain"

const tui: TuiPlugin = async (api) => {
  const directory = () => api.state.path.directory || process.cwd()

  await withInstanceAsync({ directory: directory() }, async () => {
    initBrainScheduler()
  })

  api.keymap.registerLayer({
    commands: [
      {
        name: "brain.run",
        title: "Run Brain",
        namespace: "System",
        description: "Consolidate recent sessions into long-term memory",
        slashName: "brain",
        run() {
          api.ui.dialog.clear()
          api.ui.toast({ message: "Brain started in background", variant: "info" })
          void (async () => {
            const { Brain } = await import("@/brain")
            const result = await withInstanceAsync({ directory: directory() }, () => Brain.trigger({ force: true }))
            if (!result.success) {
              api.ui.toast({
                message: result.error ?? "Brain failed",
                variant: "error",
                duration: 5000,
              })
              return
            }

            api.ui.toast({
              message: `Brain completed after reviewing ${result.sessionsReviewed} session${result.sessionsReviewed === 1 ? "" : "s"}`,
              variant: "success",
            })

            if (result.sessionID) {
              api.route.navigate("session", { sessionID: result.sessionID })
            }
          })().catch((error) => {
            api.ui.toast({
              message: error instanceof Error ? error.message : "Brain failed",
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
