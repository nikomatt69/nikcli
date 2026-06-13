import { layer as otlpLayer, enabled, liveEnabled, resource } from "./otlp"

export { TelemetryRecord } from "./telemetry-bus"

export namespace Observability {
  // Merged into every Effect runtime base (see effect/runtime.ts). Captures
  // spans in-process for the live TUI panel (on by default) and exports
  // traces/logs over OTLP when OTEL_EXPORTER_OTLP_ENDPOINT is set; no-op when
  // neither is active.
  export const layer = otlpLayer
  export const isEnabled = enabled
  export const isLiveEnabled = liveEnabled
  export const resourceInfo = resource
}
