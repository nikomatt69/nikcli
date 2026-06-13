import z from "zod"
import { BusEvent } from "@/bus/bus-event"

// A single captured telemetry span, published live over the event bus so the
// TUI can render it. Imports only `bus-event` (cycle-safe) so this module stays
// usable from the observability layer that is merged into the Effect runtime.
export const TelemetryRecord = BusEvent.define(
  "telemetry.record",
  z.object({
    id: z.string(),
    traceId: z.string(),
    parentId: z.string().optional(),
    name: z.string(),
    kind: z.string(),
    startTime: z.number(),
    durationMs: z.number(),
    statusCode: z.number().optional(),
    statusMessage: z.string().optional(),
    attributes: z.record(z.string(), z.string()).optional(),
  }),
)

export type TelemetryRecord = z.infer<typeof TelemetryRecord.properties>
