import z from "zod"
import { Schema } from "effect"
import { BusEvent } from "@/bus/bus-event"

// A single captured telemetry span, published live over the event bus so the
// TUI can render it. Imports only `bus-event` (cycle-safe) so this module stays
// usable from the observability layer that is merged into the Effect runtime.
export const TelemetryRecord = BusEvent.schema(
  "telemetry.record",
  Schema.Struct({
    id: Schema.String,
    traceId: Schema.String,
    parentId: Schema.optional(Schema.String),
    name: Schema.String,
    kind: Schema.String,
    startTime: Schema.Number,
    durationMs: Schema.Number,
    statusCode: Schema.optional(Schema.Number),
    statusMessage: Schema.optional(Schema.String),
    attributes: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  }),
)

export type TelemetryRecord = z.infer<typeof TelemetryRecord.properties>
