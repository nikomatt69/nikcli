import { Cause, Effect, Exit, Layer, Logger, Option, Tracer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { OtlpLogger, OtlpSerialization, OtlpTracer } from "effect/unstable/observability"
import { Flag } from "../flag/flag"
import { TelemetryRecord } from "./telemetry-bus"

// Build version/channel from the globals injected at compile time, mirroring
// Installation.VERSION/CHANNEL. Read directly (rather than importing
// Installation) to keep this module free of the bus/effect import cycle, so it
// can be merged into the Effect runtime base.
const version = typeof NIKCLI_VERSION === "string" ? NIKCLI_VERSION : "local"
const channel = typeof NIKCLI_CHANNEL === "string" ? NIKCLI_CHANNEL : "local"

const endpoint = Flag.OTEL_EXPORTER_OTLP_ENDPOINT

const headers = Flag.OTEL_EXPORTER_OTLP_HEADERS
  ? Flag.OTEL_EXPORTER_OTLP_HEADERS.split(",").reduce(
      (acc, entry) => {
        const [key, ...value] = entry.split("=")
        acc[key] = value.join("=")
        return acc
      },
      {} as Record<string, string>,
    )
  : undefined

// Live in-process span capture (streamed to the TUI panel) is on by default.
const live = !Flag.NIKCLI_DISABLE_OTEL_LIVE
// Whether anything observability-related is active at all.
const active = Boolean(endpoint) || live

export const enabled = Boolean(endpoint)
export const liveEnabled = live

function resourceAttributes(): Record<string, string> {
  const value = process.env["OTEL_RESOURCE_ATTRIBUTES"]
  if (!value) return {}
  try {
    return Object.fromEntries(
      value.split(",").map((entry) => {
        const index = entry.indexOf("=")
        if (index < 1) throw new Error("Invalid OTEL_RESOURCE_ATTRIBUTES entry")
        return [decodeURIComponent(entry.slice(0, index)), decodeURIComponent(entry.slice(index + 1))]
      }),
    )
  } catch {
    return {}
  }
}

export function resource(runID: string): {
  serviceName: string
  serviceVersion: string
  attributes: Record<string, string>
} {
  return {
    serviceName: "nikcli",
    serviceVersion: version,
    attributes: {
      ...resourceAttributes(),
      "deployment.environment.name": channel,
      "nikcli.client": Flag.NIKCLI_CLIENT,
      "nikcli.run": runID,
      "service.instance.id": runID,
    },
  }
}

// Publish to the event bus, imported lazily so this module never statically
// depends on bus → effect/runtime (which would form an import cycle, since the
// runtime merges this layer in).
let busPublish: ((record: TelemetryRecord) => void) | undefined
async function getPublish(): Promise<(record: TelemetryRecord) => void> {
  if (!busPublish) {
    const { Bus } = await import("@/bus")
    busPublish = (record) => void Bus.publish(TelemetryRecord, record)
  }
  return busPublish
}

function stringifyAttributes(input: Iterable<readonly [string, unknown]>): Record<string, string> | undefined {
  const out: Record<string, string> = {}
  let count = 0
  for (const [key, value] of input) {
    if (count++ >= 32) break
    if (value === undefined || value === null) continue
    const str = typeof value === "string" ? value : JSON.stringify(value)
    out[key] = str.length > 200 ? str.slice(0, 200) + "…" : str
  }
  return Object.keys(out).length ? out : undefined
}

function buildRecord(args: {
  id: string
  traceId: string
  parentId?: string
  name: string
  kind: string
  startTime: bigint
  endTime: bigint
  exit: Exit.Exit<unknown, unknown>
  attributes: Iterable<readonly [string, unknown]>
}): TelemetryRecord {
  return {
    id: args.id,
    traceId: args.traceId,
    parentId: args.parentId,
    name: args.name,
    kind: args.kind,
    startTime: Number(args.startTime / 1_000_000n),
    durationMs: Number(args.endTime - args.startTime) / 1e6,
    statusCode: Exit.isFailure(args.exit) ? 2 : 1,
    statusMessage: Exit.isFailure(args.exit) ? Cause.pretty(args.exit.cause).slice(0, 200) : undefined,
    attributes: stringifyAttributes(args.attributes),
  }
}

function publish(record: TelemetryRecord) {
  void getPublish().then((fn) => fn(record))
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("")
}

// Pure-Effect tracer that publishes each finished span to the bus. No external
// dependency, so it is robust under bundling (unlike the OpenTelemetry Node SDK,
// whose CJS getter exports do not survive ESM interop in the packaged binary).
function makeBusTracer(): Tracer.Tracer {
  return Tracer.make({
    span(options) {
      const parent = Option.getOrUndefined(options.parent)
      const traceId = parent && "traceId" in parent ? parent.traceId : randomHex(16)
      const attributes = new Map<string, unknown>()
      const span = {
        _tag: "Span" as const,
        name: options.name,
        spanId: randomHex(8),
        traceId,
        parent: options.parent,
        annotations: options.annotations,
        status: { _tag: "Started" as const, startTime: options.startTime },
        attributes,
        links: options.links,
        sampled: options.sampled,
        kind: options.kind,
        end(endTime: bigint, exit: Exit.Exit<unknown, unknown>) {
          publish(
            buildRecord({
              id: span.spanId,
              traceId: span.traceId,
              parentId: parent?.spanId,
              name: span.name,
              kind: String(options.kind),
              startTime: options.startTime,
              endTime,
              exit,
              attributes,
            }),
          )
        },
        attribute(key: string, value: unknown) {
          attributes.set(key, value)
        },
        event() {},
        addLinks() {},
      }
      return span as unknown as Tracer.Span
    },
  })
}

// Wraps a real (OTLP-exporting) tracer so spans are both exported and streamed to
// the bus for the live panel.
function wrapTracer(base: Tracer.Tracer): Tracer.Tracer {
  return Tracer.make({
    context: base.context,
    span(options) {
      const span = base.span(options)
      const realEnd = span.end.bind(span)
      ;(span as { end: Tracer.Span["end"] }).end = (endTime, exit) => {
        realEnd(endTime, exit)
        const parent = Option.getOrUndefined(options.parent)
        publish(
          buildRecord({
            id: span.spanId,
            traceId: span.traceId,
            parentId: parent?.spanId,
            name: span.name,
            kind: String(options.kind),
            startTime: options.startTime,
            endTime,
            exit,
            attributes: span.attributes,
          }),
        )
      }
      return span
    },
  })
}

// Effect logs exported over OTLP. nikcli's primary logging is the custom `Log`
// namespace, so this only carries Effect-emitted logs (Effect.log*).
function loggers(runID: string) {
  if (!endpoint) return []
  return [OtlpLogger.make({ url: `${endpoint}/v1/logs`, resource: resource(runID), headers })]
}

// The active tracer: when an OTLP endpoint is set, Effect's native OtlpTracer
// (pure Effect — no @opentelemetry) exports spans, wrapped to also feed the live
// panel; otherwise a bus-only tracer for live capture.
function tracerLayer(runID: string): Layer.Layer<never, never, never> {
  return !active
    ? Layer.empty
    : endpoint
      ? Layer.unwrap(
          Effect.gen(function* () {
            const base = yield* OtlpTracer.make({ url: `${endpoint}/v1/traces`, resource: resource(runID), headers })
            return Layer.succeed(Tracer.Tracer, live ? wrapTracer(base) : base)
          }),
        ).pipe(Layer.provide(OtlpSerialization.layerJson), Layer.provide(FetchHttpClient.layer), Layer.orDie)
      : Layer.succeed(Tracer.Tracer, makeBusTracer())
}

// Combined observability layer. Captures spans for the live TUI panel (default
// on) and exports traces/logs over OTLP when an endpoint is configured. No-op
// when nothing is active, so it can be merged into any runtime base unchanged.
export const layer: Layer.Layer<never, never, never> = active
  ? Layer.unwrap(
      Effect.gen(function* () {
        // Per-run correlation id, generated when the observability layer is
        // built rather than at module load. This keeps the module free of an
        // import-time global side effect (so the core can run in constrained
        // runtimes) and gives each runtime/isolate its own run id.
        const runID = crypto.randomUUID().slice(0, 8)
        const logs = endpoint
          ? Logger.layer(loggers(runID), { mergeWithExisting: true }).pipe(
              Layer.provide(OtlpSerialization.layerJson),
              Layer.provide(FetchHttpClient.layer),
              Layer.orDie,
            )
          : Layer.empty
        return Layer.mergeAll(logs, tracerLayer(runID))
      }),
    )
  : Layer.empty
