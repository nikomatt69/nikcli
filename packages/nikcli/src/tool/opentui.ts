import { Schema } from "effect"
import { z } from "zod"
import { zod } from "@/util/effect-zod"
import { Tool } from "./tool"
import DESCRIPTION from "./opentui.txt"

// ──────────────────────────────────────────────────────────────────────────
// Shared primitives
// ──────────────────────────────────────────────────────────────────────────

const ColorToken = Schema.Literals([
  "default",
  "primary",
  "secondary",
  "accent",
  "success",
  "warning",
  "error",
  "info",
  "muted",
])

const Severity = Schema.Literals(["info", "success", "warning", "error"])
const Trend = Schema.Literals(["up", "down", "flat"])
const Align = Schema.Literals(["left", "center", "right"])
const NumberFormat = Schema.Literals(["plain", "compact", "currency", "percent", "bytes", "duration"])
const StatusKind = Schema.Literals(["default", "success", "warning", "error", "info"])

const Threshold = Schema.Struct({
  at: Schema.Number.annotate({
    description: "Value (or % when used in gauge) at which this color kicks in",
  }),
  color: ColorToken,
})

// ──────────────────────────────────────────────────────────────────────────
// Foundational
// ──────────────────────────────────────────────────────────────────────────

const TextComponent = Schema.Struct({
  type: Schema.Literal("text"),
  title: Schema.optional(Schema.String),
  content: Schema.String.annotate({ description: "Plain text content" }),
  style: Schema.optional(Schema.Literals(["default", "info", "success", "warning", "error", "code", "muted"])).annotate(
    {
      description: "Semantic tint. style=code wraps the content in a monospace block.",
    },
  ),
})

const MarkdownComponent = Schema.Struct({
  type: Schema.Literal("markdown"),
  title: Schema.optional(Schema.String),
  content: Schema.String.annotate({
    description:
      "GitHub-flavored markdown: headings, lists, bold/italic, links, tables with borders, " +
      "and fenced code blocks (syntax-highlighted by their lang tag).",
  }),
})

const CodeComponent = Schema.Struct({
  type: Schema.Literal("code"),
  title: Schema.optional(Schema.String),
  filetype: Schema.String.annotate({
    description: "Language identifier for syntax highlighting (e.g. 'ts', 'tsx', 'bash', 'python', 'json', 'sql').",
  }),
  content: Schema.String.annotate({
    description: "Raw code to render. Do not wrap in markdown fences.",
  }),
  showLineNumbers: Schema.optional(Schema.Boolean),
})

const DiffComponent = Schema.Struct({
  type: Schema.Literal("diff"),
  title: Schema.optional(Schema.String),
  filetype: Schema.optional(Schema.String).annotate({
    description: "Language tag used for in-line syntax highlighting of unchanged context.",
  }),
  before: Schema.String.annotate({
    description: "Original content (left side)",
  }),
  after: Schema.String.annotate({ description: "New content (right side)" }),
  mode: Schema.optional(Schema.Literals(["unified", "split"])).annotate({
    description: "unified = single column with +/- lines (default). split = side-by-side.",
  }),
})

const AlertComponent = Schema.Struct({
  type: Schema.Literal("alert"),
  severity: Severity.annotate({
    description: "Drives icon and color: info / success / warning / error",
  }),
  title: Schema.optional(Schema.String),
  message: Schema.String,
})

// ──────────────────────────────────────────────────────────────────────────
// Data display
// ──────────────────────────────────────────────────────────────────────────

const TableComponent = Schema.Struct({
  type: Schema.Literal("table"),
  title: Schema.optional(Schema.String),
  headers: Schema.Array(Schema.String).pipe(Schema.check(Schema.isMinLength(1))),
  rows: Schema.Array(Schema.Array(Schema.String)).annotate({
    description: "2D array of cell values. Each inner array must match headers length.",
  }),
  align: Schema.optional(Schema.Array(Align)).annotate({
    description: "Per-column alignment. Length should match headers; missing entries default to left.",
  }),
  totals: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Optional totals/summary row rendered with separator.",
  }),
  rowColors: Schema.optional(Schema.Array(Schema.NullOr(ColorToken))).annotate({
    description:
      "Tint individual rows by index for emphasis (e.g. flag risky rows in red). " +
      "Use null at an index to leave that row's color unchanged.",
  }),
})

const KeyValueComponent = Schema.Struct({
  type: Schema.Literal("key_value"),
  title: Schema.optional(Schema.String),
  items: Schema.Array(
    Schema.Struct({
      key: Schema.String,
      value: Schema.String,
      status: Schema.optional(StatusKind),
      group: Schema.optional(Schema.String).annotate({
        description: "Optional section heading. Consecutive items sharing the same group are clustered.",
      }),
    }),
  ),
})

// Depth-bounded tree schema. Avoids Schema.suspend recursion which breaks
// zod-to-json-schema. 4 levels of nesting is plenty for dashboard usage
// (file trees, dependency graphs, taxonomies).
const TreeNodeLeafFields = {
  label: Schema.String,
  value: Schema.optional(Schema.String),
  status: Schema.optional(Severity),
}
const TreeNodeL4 = Schema.Struct(TreeNodeLeafFields)
const TreeNodeL3 = Schema.Struct({
  ...TreeNodeLeafFields,
  children: Schema.optional(Schema.Array(TreeNodeL4)),
})
const TreeNodeL2 = Schema.Struct({
  ...TreeNodeLeafFields,
  children: Schema.optional(Schema.Array(TreeNodeL3)),
})
const TreeNodeL1 = Schema.Struct({
  ...TreeNodeLeafFields,
  children: Schema.optional(Schema.Array(TreeNodeL2)),
})

const TreeComponent = Schema.Struct({
  type: Schema.Literal("tree"),
  title: Schema.optional(Schema.String),
  nodes: Schema.Array(TreeNodeL1).pipe(Schema.check(Schema.isMinLength(1))),
})

// Public, runtime-recursive type used by the renderer (no JSON-schema impact)
export interface VizTreeNode {
  readonly label: string
  readonly value?: string | undefined
  readonly status?: Schema.Schema.Type<typeof Severity> | undefined
  readonly children?: ReadonlyArray<VizTreeNode> | undefined
}

// ──────────────────────────────────────────────────────────────────────────
// Statistics
// ──────────────────────────────────────────────────────────────────────────

const StatItem = Schema.Struct({
  label: Schema.String.annotate({
    description: "What the number represents (e.g. 'Requests/min')",
  }),
  value: Schema.Union([Schema.String, Schema.Number]).annotate({
    description: "The primary value. Numeric values can be auto-formatted via `format`.",
  }),
  unit: Schema.optional(Schema.String).annotate({
    description: "Suffix appended to the value (e.g. 'ms', '%')",
  }),
  delta: Schema.optional(Schema.Number).annotate({
    description: "Signed change vs previous period. Sign and `trend` together drive color.",
  }),
  deltaUnit: Schema.optional(Schema.String).annotate({
    description: "Unit suffix for the delta (e.g. '%', 'pp')",
  }),
  trend: Schema.optional(Trend).annotate({
    description: "Direction arrow. up=▲, down=▼, flat=▬. Semantics depend on context (more isn't always good).",
  }),
  trendIsGood: Schema.optional(Schema.Boolean).annotate({
    description: "Defaults to true (up=good). Set false when growth is bad (e.g. error rate).",
  }),
  format: Schema.optional(NumberFormat).annotate({
    description:
      "plain (raw), compact (1.2k/3.4M), percent (0.5 → 50%), currency (USD), bytes (KB/MB/GB), duration (ms/s/m).",
  }),
  color: Schema.optional(ColorToken).annotate({
    description: "Override accent color for the value.",
  }),
  sparkline: Schema.optional(Schema.Array(Schema.Number)).annotate({
    description: "Up to ~40 recent values. Renders an inline ▁▂▃▄▅▆▇█ sparkline.",
  }),
  hint: Schema.optional(Schema.String).annotate({
    description: "One-line context shown beneath the number.",
  }),
})

const StatComponent = Schema.Struct({
  type: Schema.Literal("stat"),
  title: Schema.optional(Schema.String),
  ...StatItem.fields,
})

const StatGridComponent = Schema.Struct({
  type: Schema.Literal("stat_grid"),
  title: Schema.optional(Schema.String),
  columns: Schema.optional(
    Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1)), Schema.check(Schema.isLessThanOrEqualTo(4))),
  ).annotate({
    description: "1–4. Default auto-picks based on terminal width.",
  }),
  items: Schema.Array(StatItem).pipe(Schema.check(Schema.isMinLength(1)), Schema.check(Schema.isMaxLength(12))),
})

// ──────────────────────────────────────────────────────────────────────────
// Charts
// ──────────────────────────────────────────────────────────────────────────

const BarChartComponent = Schema.Struct({
  type: Schema.Literal("bar_chart"),
  title: Schema.optional(Schema.String),
  orientation: Schema.optional(Schema.Literals(["horizontal", "vertical"])).annotate({
    description: "horizontal (default) — labels on left, bars extend right. vertical — bars rise from a baseline.",
  }),
  items: Schema.Array(
    Schema.Struct({
      label: Schema.String,
      value: Schema.Number,
      unit: Schema.optional(Schema.String),
      color: Schema.optional(ColorToken),
    }),
  ).pipe(Schema.check(Schema.isMinLength(1))),
  maxValue: Schema.optional(Schema.Number).annotate({
    description: "Override the 100% ceiling. Defaults to max(items.value).",
  }),
  barWidth: Schema.optional(
    Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(10)), Schema.check(Schema.isLessThanOrEqualTo(60))),
  ),
  showValues: Schema.optional(Schema.Boolean).annotate({
    description: "Append the numeric value next to each bar.",
  }),
  showPercentages: Schema.optional(Schema.Boolean).annotate({
    description: "Append the % of max next to each bar.",
  }),
})

const LineSeries = Schema.Struct({
  name: Schema.String,
  values: Schema.Array(Schema.Number).pipe(Schema.check(Schema.isMinLength(2))),
  color: Schema.optional(ColorToken),
})

const LineChartComponent = Schema.Struct({
  type: Schema.Literal("line_chart"),
  title: Schema.optional(Schema.String),
  series: Schema.Array(LineSeries).pipe(Schema.check(Schema.isMinLength(1)), Schema.check(Schema.isMaxLength(6))),
  labels: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Optional x-axis labels. Will be sparsified to fit the available width.",
  }),
  yMin: Schema.optional(Schema.Number),
  yMax: Schema.optional(Schema.Number),
  height: Schema.optional(
    Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(4)), Schema.check(Schema.isLessThanOrEqualTo(20))),
  ).annotate({ description: "Rows for the plot area. Default 8." }),
  showLegend: Schema.optional(Schema.Boolean).annotate({
    description: "Default true when series count > 1.",
  }),
  showAxis: Schema.optional(Schema.Boolean).annotate({
    description: "Render y-axis with min/max ticks. Default true.",
  }),
  yUnit: Schema.optional(Schema.String),
})

const HistogramComponent = Schema.Struct({
  type: Schema.Literal("histogram"),
  title: Schema.optional(Schema.String),
  bins: Schema.Array(
    Schema.Struct({
      label: Schema.String.annotate({
        description: "Bin label, e.g. '0-10' or 'p99'",
      }),
      count: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
    }),
  ).pipe(Schema.check(Schema.isMinLength(1))),
  unit: Schema.optional(Schema.String),
})

const HeatmapComponent = Schema.Struct({
  type: Schema.Literal("heatmap"),
  title: Schema.optional(Schema.String),
  rowLabels: Schema.Array(Schema.String).pipe(Schema.check(Schema.isMinLength(1))),
  colLabels: Schema.Array(Schema.String).pipe(Schema.check(Schema.isMinLength(1))),
  values: Schema.Array(Schema.Array(Schema.Number)).annotate({
    description: "2D matrix: values[rowIndex][colIndex]. Must match labels' lengths.",
  }),
  min: Schema.optional(Schema.Number),
  max: Schema.optional(Schema.Number),
  colorScale: Schema.optional(Schema.Literals(["mono", "diverge", "traffic"])).annotate({
    description: "mono: single hue intensity. diverge: cool/warm around zero. traffic: green→yellow→red.",
  }),
  unit: Schema.optional(Schema.String),
})

const GaugeComponent = Schema.Struct({
  type: Schema.Literal("gauge"),
  title: Schema.optional(Schema.String),
  label: Schema.String,
  value: Schema.Number,
  max: Schema.Number.pipe(Schema.check(Schema.isGreaterThan(0))),
  min: Schema.optional(Schema.Number),
  unit: Schema.optional(Schema.String),
  thresholds: Schema.optional(Schema.Array(Threshold)).annotate({
    description: "Color stops by % of max (e.g. [{at:70,color:'warning'},{at:90,color:'error'}]).",
  }),
})

const ProgressBarsComponent = Schema.Struct({
  type: Schema.Literal("progress_bars"),
  title: Schema.optional(Schema.String),
  items: Schema.Array(
    Schema.Struct({
      label: Schema.String,
      value: Schema.Number.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
      max: Schema.Number.pipe(Schema.check(Schema.isGreaterThan(0))),
      unit: Schema.optional(Schema.String),
    }),
  ).pipe(Schema.check(Schema.isMinLength(1))),
  barWidth: Schema.optional(
    Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(10)), Schema.check(Schema.isLessThanOrEqualTo(60))),
  ),
  thresholds: Schema.optional(Schema.Array(Threshold)).annotate({
    description: "Optional % thresholds that recolor bars (e.g. [{at:80,color:'warning'},{at:95,color:'error'}]).",
  }),
})

// ──────────────────────────────────────────────────────────────────────────
// Process & state
// ──────────────────────────────────────────────────────────────────────────

const TimelineComponent = Schema.Struct({
  type: Schema.Literal("timeline"),
  title: Schema.optional(Schema.String),
  events: Schema.Array(
    Schema.Struct({
      time: Schema.optional(Schema.String).annotate({
        description: "Timestamp / label shown on the right",
      }),
      duration: Schema.optional(Schema.String).annotate({
        description: "Step duration, e.g. '2.4s'",
      }),
      label: Schema.String,
      status: Schema.Literals(["done", "active", "pending", "error", "skipped"]).annotate({
        description: "done=✓ green, active=● primary, pending=○ muted, error=✗ red, skipped=∅ muted",
      }),
      detail: Schema.optional(Schema.String),
    }),
  ).pipe(Schema.check(Schema.isMinLength(1))),
})

const StatusGridComponent = Schema.Struct({
  type: Schema.Literal("status_grid"),
  title: Schema.optional(Schema.String),
  items: Schema.Array(
    Schema.Struct({
      label: Schema.String,
      status: Severity,
      detail: Schema.optional(Schema.String),
    }),
  ).pipe(Schema.check(Schema.isMinLength(1))),
  columns: Schema.optional(
    Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1)), Schema.check(Schema.isLessThanOrEqualTo(6))),
  ).annotate({ description: "1–6. Default auto." }),
})

// ──────────────────────────────────────────────────────────────────────────
// Leaf union (anything that can be nested in a container)
// ──────────────────────────────────────────────────────────────────────────

const LeafComponent = Schema.Union([
  TextComponent,
  MarkdownComponent,
  CodeComponent,
  DiffComponent,
  AlertComponent,
  TableComponent,
  KeyValueComponent,
  TreeComponent,
  StatComponent,
  StatGridComponent,
  BarChartComponent,
  LineChartComponent,
  HistogramComponent,
  HeatmapComponent,
  GaugeComponent,
  ProgressBarsComponent,
  TimelineComponent,
  StatusGridComponent,
])

// ──────────────────────────────────────────────────────────────────────────
// Layout containers
// ──────────────────────────────────────────────────────────────────────────

const GridComponent = Schema.Struct({
  type: Schema.Literal("grid"),
  title: Schema.optional(Schema.String),
  columns: Schema.optional(
    Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1)), Schema.check(Schema.isLessThanOrEqualTo(4))),
  ).annotate({ description: "1–4. Default auto." }),
  children: Schema.Array(LeafComponent).pipe(Schema.check(Schema.isMinLength(1)), Schema.check(Schema.isMaxLength(30))),
})

/** Children inside a section: leaf components or a nested grid (not full section nesting). */
const SectionChild = Schema.Union([LeafComponent, GridComponent])

const SectionComponent = Schema.Struct({
  type: Schema.Literal("section"),
  title: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  children: Schema.Array(SectionChild).pipe(Schema.check(Schema.isMinLength(1)), Schema.check(Schema.isMaxLength(30))),
})

const VisualizationComponent = Schema.Union([LeafComponent, SectionComponent, GridComponent])

// ──────────────────────────────────────────────────────────────────────────
// Public types
// ──────────────────────────────────────────────────────────────────────────

export type VizComponent = Schema.Schema.Type<typeof VisualizationComponent>
export type VizLeaf = Schema.Schema.Type<typeof LeafComponent>
export type VizColorToken = Schema.Schema.Type<typeof ColorToken>
export type VizSeverity = Schema.Schema.Type<typeof Severity>
export type VizTrend = Schema.Schema.Type<typeof Trend>
export type VizNumberFormat = Schema.Schema.Type<typeof NumberFormat>
export type VizAlign = Schema.Schema.Type<typeof Align>
export type VizThreshold = Schema.Schema.Type<typeof Threshold>
export type OpenTUIVizSpecType = {
  title: string
  subtitle?: string
  components: VizComponent[]
}

const Parameters = Schema.Struct({
  title: Schema.String.annotate({
    description: "Overall title shown in the dialog header",
  }),
  subtitle: Schema.optional(Schema.String).annotate({
    description: "Optional one-line subtitle under the title (e.g. environment, timestamp, source).",
  }),
  components: Schema.Array(VisualizationComponent)
    .pipe(Schema.check(Schema.isMinLength(1)), Schema.check(Schema.isMaxLength(30)))
    .annotate({
      description:
        "Top-level components. Tabs appear when there are 2+ — keys 1-9 jump to tabs 1-9, 0 jumps to tab 10; use tab/shift+tab for all tabs. " +
        "Use `section` and `grid` to compose richer single-tab dashboards.",
    }),
})

/**
 * Component-level Zod validator derived from the same catalog the AI is
 * constrained to. The streaming compiler (`spec-stream.ts`) uses this to decide
 * whether a partially-streamed component is "render-safe" yet: a component is
 * shown only once it `safeParse`s cleanly, exactly like json-render validates
 * incremental output against its catalog before mounting it.
 */
export const VizComponentZod = zod(VisualizationComponent)

// Single-key wrappers some models emit around array elements ({item:{…}}).
const WRAPPER_KEYS = new Set(["item", "component", "element", "node", "child"])

/** Recursively strip single-key wrapper objects so wrapped components validate. */
export function deepUnwrap(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepUnwrap)
  if (value && typeof value === "object") {
    const keys = Object.keys(value as object)
    if (keys.length === 1 && WRAPPER_KEYS.has(keys[0]!)) {
      return deepUnwrap((value as Record<string, unknown>)[keys[0]!])
    }
    const out: Record<string, unknown> = {}
    for (const k of keys) out[k] = deepUnwrap((value as Record<string, unknown>)[k])
    return out
  }
  return value
}

/**
 * Returns the parsed component when it is complete enough to render, else
 * undefined. Tolerates the common `{item:{…}}` wrapping before validating.
 */
export function decodeVizComponent(value: unknown): VizComponent | undefined {
  const res = VizComponentZod.safeParse(deepUnwrap(value))
  return res.success ? (res.data as VizComponent) : undefined
}

/** Validate + repair a raw components array, dropping anything unrenderable. */
export function normalizeVizComponents(components: unknown): VizComponent[] {
  if (!Array.isArray(components)) return []
  const out: VizComponent[] = []
  for (const candidate of components) {
    const decoded = decodeVizComponent(candidate)
    if (decoded) out.push(decoded)
  }
  return out
}

/**
 * Full-spec Zod schema (title + subtitle + components), suitable for AI SDK
 * `streamObject({ schema })` when generating a TUI directly rather than via the
 * agent's tool loop. Reuses the exact same catalog the tool is built from.
 */
export const VizSpecZod = zod(Parameters)

/**
 * Tool-call parser-safe variant of {@link VizSpecZod}.
 *
 * The tool-call layer that sits between the model and `Tool.define` (Bun's plugin
 * resolver, AI SDK adapters, manual invocations) sometimes wraps every object
 * payload in a single-key envelope such as `{ item: { ... } }` (or `component`,
 * `element`, `node`, `child`). Under Effect-Schema's `strict` mode those
 * envelopes break validation even though the inner object is valid. We pre-process
 * the raw input with {@link deepUnwrap} before letting Zod see it, so the inner
 * object is recovered recursively at every nesting level.
 *
 * This is what the OpenTUI tool actually uses; {@link VizSpecZod} remains
 * exported for callers (e.g. `streamObject`, the streaming compiler) that do not
 * need this normalization.
 */
export const SafeVizSpecZod = z.preprocess(deepUnwrap, VizSpecZod)

// ──────────────────────────────────────────────────────────────────────────
// Catalog — json-render's `defineCatalog(...)` surface, for OpenTUI
// ──────────────────────────────────────────────────────────────────────────

/**
 * Every component `type` the model may emit, in catalogue order. This is the
 * single source of truth the streaming compiler validates against and the
 * renderer registry (`dialog-opentui-viz.tsx`) must cover one-to-one.
 */
export const VIZ_COMPONENT_TYPES = [
  "text",
  "markdown",
  "code",
  "diff",
  "alert",
  "table",
  "key_value",
  "tree",
  "stat",
  "stat_grid",
  "bar_chart",
  "line_chart",
  "histogram",
  "heatmap",
  "gauge",
  "progress_bars",
  "timeline",
  "status_grid",
  "section",
  "grid",
] as const satisfies ReadonlyArray<VizComponent["type"]>

export type VizComponentType = (typeof VIZ_COMPONENT_TYPES)[number]

/** Result of validating raw model output against the catalog (never throws). */
export type VizValidationResult = {
  /** True when every supplied component was render-safe. */
  valid: boolean
  /** The repaired, render-safe spec (always present, possibly empty). */
  spec: OpenTUIVizSpecType
  /** How many supplied components were dropped as unrenderable. */
  dropped: number
}

/**
 * The OpenTUI visualization **catalog** — nikcli's analogue to json-render's
 * `defineCatalog(schema, config)` return value. It is the one place that knows
 * the component vocabulary, the prompt that teaches a model to use it, the Zod
 * and JSON schemas the model is constrained to, and how to validate/repair raw
 * output into a render-safe spec.
 *
 * Mirrors the json-render `Catalog` instance surface:
 * `prompt()`, `validate(spec)`, `zodSchema()`, `jsonSchema()`, `componentNames`.
 */
export const VizCatalog = {
  /** json-render: `catalog.componentNames`. */
  componentNames: VIZ_COMPONENT_TYPES,
  /** json-render: `catalog.prompt()` — the system prompt describing the catalog. */
  prompt(): string {
    return DESCRIPTION
  },
  /** json-render: `catalog.zodSchema()`. */
  zodSchema(): z.ZodType {
    return VizSpecZod
  },
  /** json-render: `catalog.jsonSchema()`. Best-effort; never throws. */
  jsonSchema(): object {
    try {
      return z.toJSONSchema(VizSpecZod, { target: "draft-7" }) as object
    } catch {
      return {}
    }
  },
  /** Decode + repair a single component, or undefined when not render-safe. */
  decodeComponent: decodeVizComponent,
  /** json-render: `catalog.validate(spec)`. Repairs and never throws. */
  validate(input: unknown): VizValidationResult {
    const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>
    const rawComponents = Array.isArray(obj.components) ? obj.components : []
    const components = normalizeVizComponents(rawComponents)
    const title = typeof obj.title === "string" && obj.title.trim() ? obj.title : "Visualization"
    const spec: OpenTUIVizSpecType = {
      title,
      subtitle: typeof obj.subtitle === "string" ? obj.subtitle : undefined,
      components,
    }
    return {
      valid: components.length === rawComponents.length && components.length > 0,
      spec,
      dropped: rawComponents.length - components.length,
    }
  },
} as const

export const OpenTUIVizTool = Tool.define("opentui", {
  description: DESCRIPTION,
  // Use the parser-safe schema so wrapped tool-call payloads (e.g. `{item: ...}`)
  // validate cleanly. See SafeVizSpecZod for the full rationale.
  parameters: SafeVizSpecZod,
  async execute(params, _ctx) {
    const flatCount = countFlatComponents(params.components as VizComponent[])
    return {
      title: params.title,
      output:
        `Visualization "${params.title}" ready ` +
        `(${params.components.length} top-level component${params.components.length === 1 ? "" : "s"}, ${flatCount} total).`,
      metadata: { spec: params, truncated: false },
    }
  },
})

function countFlatComponents(components: VizComponent[]): number {
  let n = 0
  for (const c of components) {
    n += 1
    if (c.type === "section" || c.type === "grid") {
      n += c.children.length
    }
  }
  return n
}
