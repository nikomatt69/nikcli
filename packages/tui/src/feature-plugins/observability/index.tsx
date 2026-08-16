/**
 * Observability — internal TUI plugin.
 *
 * Mirrors `feature-plugins/loops`: surfaces the OpenTelemetry pipeline (see
 * `src/observability/`) in the TUI as a self-contained plugin instead of
 * hard-coded commands in `app.tsx`. Registers the `/otel` slash command
 * (aliases: `/telemetry`, `/opentelemetry`) that opens the OpenTelemetry
 * settings panel, plus a "Live telemetry" command that jumps straight to the
 * streaming span viewer.
 */
import type { TuiPlugin, TuiPluginModule } from "@nikcli-ai/plugin/tui"
import { DialogOpenTelemetry, DialogTelemetryLive } from "./dialogs"

const id = "internal:observability"

const tui: TuiPlugin = async (api) => {
  api.keymap.registerLayer({
    commands: [
      {
        name: "otel.settings",
        title: "OpenTelemetry",
        namespace: "System",
        description: "Toggle AI SDK telemetry & inspect OTLP export status",
        slashName: "otel",
        slashAliases: ["telemetry", "opentelemetry"],
        run() {
          api.ui.dialog.replace(() => <DialogOpenTelemetry />)
        },
      },
      {
        name: "otel.live",
        title: "Live telemetry",
        namespace: "System",
        description: "Stream spans as they happen",
        run() {
          api.ui.dialog.replace(() => <DialogTelemetryLive />)
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
