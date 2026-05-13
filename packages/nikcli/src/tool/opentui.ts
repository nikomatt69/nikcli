import { Schema } from "effect"
import { zod } from "@/util/effect-zod"
import { Tool } from "./tool"

const BarChartComponent = Schema.Struct({
  type: Schema.Literal("bar_chart"),
  title: Schema.optional(Schema.String).annotate({ description: "Optional heading for this chart" }),
  items: Schema.Array(
    Schema.Struct({
      label: Schema.String.annotate({ description: "Bar label, shown to the left" }),
      value: Schema.Number.annotate({ description: "Numeric value for this bar" }),
      unit: Schema.optional(Schema.String).annotate({ description: "Optional unit suffix, e.g. '%', 'ms'" }),
    }),
  )
    .pipe(Schema.check(Schema.isMinLength(1)))
    .annotate({ description: "Data rows. Values are normalised to the maximum automatically." }),
  maxValue: Schema.optional(Schema.Number).annotate({
    description: "Override the 100% ceiling. Defaults to the largest value in items.",
  }),
  barWidth: Schema.optional(
    Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(10)), Schema.check(Schema.isLessThanOrEqualTo(60))),
  ).annotate({ description: "Character width of the bar area. Defaults to 40." }),
})

const TableComponent = Schema.Struct({
  type: Schema.Literal("table"),
  title: Schema.optional(Schema.String),
  headers: Schema.Array(Schema.String)
    .pipe(Schema.check(Schema.isMinLength(1)))
    .annotate({ description: "Column header labels" }),
  rows: Schema.Array(Schema.Array(Schema.String)).annotate({
    description: "2D array of cell values. Each inner array must match headers length.",
  }),
})

const KeyValueComponent = Schema.Struct({
  type: Schema.Literal("key_value"),
  title: Schema.optional(Schema.String),
  items: Schema.Array(
    Schema.Struct({
      key: Schema.String,
      value: Schema.String,
      status: Schema.optional(Schema.Literals(["default", "success", "warning", "error", "info"])).annotate({
        description:
          "Colour-codes the value: success=green, warning=yellow, error=red, info=blue, default=text",
      }),
    }),
  ),
})

const ProgressBarsComponent = Schema.Struct({
  type: Schema.Literal("progress_bars"),
  title: Schema.optional(Schema.String),
  items: Schema.Array(
    Schema.Struct({
      label: Schema.String,
      value: Schema.Number.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))).annotate({ description: "Current value" }),
      max: Schema.Number.pipe(Schema.check(Schema.isGreaterThan(0))).annotate({ description: "Maximum value (100% mark)" }),
      unit: Schema.optional(Schema.String),
    }),
  ),
  barWidth: Schema.optional(
    Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(10)), Schema.check(Schema.isLessThanOrEqualTo(60))),
  ),
})

const TextComponent = Schema.Struct({
  type: Schema.Literal("text"),
  title: Schema.optional(Schema.String),
  content: Schema.String.annotate({ description: "Plain or markdown-lite text content" }),
  style: Schema.optional(
    Schema.Literals(["default", "info", "success", "warning", "error", "code", "muted"]),
  ).annotate({
    description:
      "Semantic colour: info=blue, success=green, warning=yellow, error=red, code=monospace block, muted=subdued",
  }),
})

const TimelineComponent = Schema.Struct({
  type: Schema.Literal("timeline"),
  title: Schema.optional(Schema.String),
  events: Schema.Array(
    Schema.Struct({
      time: Schema.optional(Schema.String).annotate({ description: "Human-readable timestamp or duration label" }),
      label: Schema.String.annotate({ description: "Event description" }),
      status: Schema.Literals(["done", "active", "pending", "error"]).annotate({
        description: "done=✓, active=●, pending=○, error=✗",
      }),
      detail: Schema.optional(Schema.String).annotate({
        description: "Optional secondary text rendered below the label",
      }),
    }),
  ),
})

const VisualizationComponent = Schema.Union([
  BarChartComponent,
  TableComponent,
  KeyValueComponent,
  ProgressBarsComponent,
  TextComponent,
  TimelineComponent,
])

export type OpenTUIVizSpecType = {
  title: string
  components: Schema.Schema.Type<typeof VisualizationComponent>[]
}

export type VizComponent = Schema.Schema.Type<typeof VisualizationComponent>

const Parameters = Schema.Struct({
  title: Schema.String.annotate({ description: "Overall title shown in the dialog header" }),
  components: Schema.Array(VisualizationComponent)
    .pipe(Schema.check(Schema.isMinLength(1)), Schema.check(Schema.isMaxLength(8)))
    .annotate({
      description:
        "One or more visualization blocks. Use multiple components to build dashboards. " +
        "Tab-navigation is shown automatically when there are 2+ components.",
    }),
})

const DESCRIPTION = `
Render a rich terminal visualization in the TUI dialog panel.

Use this tool whenever the user would benefit from seeing data visually rather than as prose:
- metrics, benchmarks, performance results → bar_chart or progress_bars
- structured data with rows and columns → table
- config, status fields, environment details → key_value
- deployment steps, process stages, event logs → timeline
- explanatory paragraphs, code snippets, alerts → text

Component types:
  bar_chart     ASCII bar chart. Supply label+value pairs; bars scale automatically.
                Use barWidth (10–60) to control chart width. Add unit for axis label.
  table         Grid of headers + rows rendered as a markdown table.
  key_value     Label: Value pairs. Set status to colour-code values (success/warning/error/info).
  progress_bars Fill-bar indicators for tasks or quotas. value/max defines % fill.
  text          Styled text block. style=code wraps in a code block, others tint the text.
  timeline      Ordered event list with status icons (done ✓ / active ● / pending ○ / error ✗).

Tips:
- Combine up to 8 components for a dashboard; the user can Tab between them.
- Keep labels short (under 20 chars) so bars and tables render cleanly in 80-column terminals.
- For bar_chart and progress_bars, supply a unit such as "%" or "req/s" when relevant.
- Use timeline to show pipeline stages; set status=active for the currently running step.
`.trim()

export const OpenTUIVizTool = Tool.define("opentui", {
  description: DESCRIPTION,
  parameters: zod(Parameters),
  async execute(params, _ctx) {
    return {
      title: params.title,
      output: `Visualization ready: "${params.title}" (${params.components.length} component${params.components.length === 1 ? "" : "s"})`,
      metadata: { spec: params, truncated: false },
    }
  },
})
