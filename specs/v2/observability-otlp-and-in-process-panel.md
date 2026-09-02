# Observability: In-Process Panel & OTLP Export

| Field  | Value                                                                                           |
| ------ | ----------------------------------------------------------------------------------------------- |
| Status | **Proposed**                                                                                    |
| Scope  | `src/observability/index.ts`, `src/observability/otlp.ts`, `src/observability/telemetry-bus.ts` |

The question this records: how spans and telemetry are captured in-process for the TUI and exported externally.

The answer is **a dual-mode Effect telemetry layer**: in-process span streaming is **on by default** for the TUI panel, while external OTLP exporting is activated when `OTEL_EXPORTER_OTLP_ENDPOINT` is configured.

## The Surface

- **In-Process Telemetry**: Active by default (`!Flag.NIKCLI_DISABLE_OTEL_LIVE`). Captures trace spans during effect execution and publishes `TelemetryRecord` events on the bus for real-time TUI rendering.
- **OTLP Exporter**: Activated when `OTEL_EXPORTER_OTLP_ENDPOINT` is set in the environment. Exports traces/logs using standard OpenTelemetry protocols.
- **Resource Attributes**: Merges operator-provided `OTEL_RESOURCE_ATTRIBUTES` and `OTEL_SERVICE_NAME` with nikcli runtime tags (`nikcli.client`, `nikcli.run`, `service.instance.id`).
- **Telemetry Record**: Standardized schema (`TelemetryRecord`) containing `id`, `traceId`, `parentId`, `name`, `kind`, `startTime`, `durationMs`, and optional status/attributes.

## Invariants

- Live in-process capture requires no external collector and runs out-of-the-box.
- OTLP export is zero-overhead / no-op when the endpoint flag is unset.
- Standard OpenTelemetry environment variables always override internal defaults.
