import { createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "../ui/toast"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { DialogTelemetryLive } from "./dialog-telemetry-live"

// AI SDK telemetry defaults to on (see session/llm.ts and agent/agent.ts:
// `cfg.experimental?.openTelemetry ?? true`), so anything that isn't an explicit
// `false` counts as enabled here.
function telemetryEnabled(config: any): boolean {
  return config?.experimental?.openTelemetry !== false
}

export function DialogOpenTelemetry() {
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()
  const dialog = useDialog()

  const config = createMemo(() => sync.data.config as any)
  const enabled = createMemo(() => telemetryEnabled(config()))
  // OTLP traces/logs are only exported when an endpoint is configured. The TUI
  // worker inherits the launching process env, so this reflects the real setup.
  const endpoint = createMemo(() => process.env["OTEL_EXPORTER_OTLP_ENDPOINT"])

  const toggle = async () => {
    const next = !enabled()
    try {
      await sdk.client.config.update({
        config: { experimental: { openTelemetry: next } } as any,
      })
      toast.show({
        message: next ? "AI SDK telemetry enabled" : "AI SDK telemetry disabled",
        variant: "success",
      })
    } catch (error: any) {
      toast.show({ message: `Failed to update: ${error.message}`, variant: "error" })
    }
  }

  const options = createMemo((): DialogSelectOption<string>[] => {
    const url = endpoint()
    const exporting = enabled() && Boolean(url)
    return [
      {
        title: "Live telemetry ▸",
        value: "live",
        description: "Stream spans as they happen",
        category: "Settings",
        onSelect: () => dialog.replace(() => <DialogTelemetryLive />),
      },
      {
        title: `AI SDK telemetry: ${enabled() ? "On" : "Off"}`,
        value: "toggle",
        description: enabled()
          ? "Spans are recorded for AI SDK calls. Select to turn off."
          : "AI SDK calls are not instrumented. Select to turn on.",
        category: "Settings",
        onSelect: () => void toggle(),
      },
      {
        title: "OTLP export endpoint",
        value: "endpoint",
        description: url ?? "Not configured — set OTEL_EXPORTER_OTLP_ENDPOINT to export traces and logs",
        category: "Export",
        disabled: true,
      },
      {
        title: "Status",
        value: "status",
        description: exporting
          ? `Exporting to ${url}`
          : enabled()
            ? "Telemetry on, but no endpoint configured (spans go nowhere)"
            : "Telemetry off",
        category: "Export",
        disabled: true,
      },
      {
        title: "Service",
        value: "service",
        description: "nikcli — set OTEL_RESOURCE_ATTRIBUTES to add custom resource attributes",
        category: "Export",
        disabled: true,
      },
    ]
  })

  return <DialogSelect title="OpenTelemetry" options={options()} />
}
