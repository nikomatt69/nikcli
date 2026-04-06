import z from "zod"
import { Tool } from "./tool"

const BarChartComponent = z.object({
  type: z.literal("bar_chart"),
  title: z.string().optional().describe("Optional heading for this chart"),
  items: z
    .array(
      z.object({
        label: z.string().describe("Bar label, shown to the left"),
        value: z.number().describe("Numeric value for this bar"),
        unit: z.string().optional().describe("Optional unit suffix, e.g. '%', 'ms'"),
      }),
    )
    .min(1)
    .describe("Data rows. Values are normalised to the maximum automatically."),
  maxValue: z
    .number()
    .optional()
    .describe("Override the 100% ceiling. Defaults to the largest value in items."),
  barWidth: z
    .number()
    .int()
    .min(10)
    .max(60)
    .optional()
    .describe("Character width of the bar area. Defaults to 40."),
})

const TableComponent = z.object({
  type: z.literal("table"),
  title: z.string().optional(),
  headers: z.array(z.string()).min(1).describe("Column header labels"),
  rows: z
    .array(z.array(z.string()))
    .describe("2D array of cell values. Each inner array must match headers length."),
})

const KeyValueComponent = z.object({
  type: z.literal("key_value"),
  title: z.string().optional(),
  items: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
      status: z
        .enum(["default", "success", "warning", "error", "info"])
        .optional()
        .describe(
          "Colour-codes the value: success=green, warning=yellow, error=red, info=blue, default=text",
        ),
    }),
  ),
})

const ProgressBarsComponent = z.object({
  type: z.literal("progress_bars"),
  title: z.string().optional(),
  items: z.array(
    z.object({
      label: z.string(),
      value: z.number().min(0).describe("Current value"),
      max: z.number().positive().describe("Maximum value (100% mark)"),
      unit: z.string().optional(),
    }),
  ),
  barWidth: z.number().int().min(10).max(60).optional(),
})

const TextComponent = z.object({
  type: z.literal("text"),
  title: z.string().optional(),
  content: z.string().describe("Plain or markdown-lite text content"),
  style: z
    .enum(["default", "info", "success", "warning", "error", "code", "muted"])
    .optional()
    .describe(
      "Semantic colour: info=blue, success=green, warning=yellow, error=red, code=monospace block, muted=subdued",
    ),
})

const TimelineComponent = z.object({
  type: z.literal("timeline"),
  title: z.string().optional(),
  events: z.array(
    z.object({
      time: z.string().optional().describe("Human-readable timestamp or duration label"),
      label: z.string().describe("Event description"),
      status: z
        .enum(["done", "active", "pending", "error"])
        .describe("done=✓, active=●, pending=○, error=✗"),
      detail: z.string().optional().describe("Optional secondary text rendered below the label"),
    }),
  ),
})

const VisualizationComponent = z.discriminatedUnion("type", [
  BarChartComponent,
  TableComponent,
  KeyValueComponent,
  ProgressBarsComponent,
  TextComponent,
  TimelineComponent,
])

export type OpenTUIVizSpecType = {
  title: string
  components: z.infer<typeof VisualizationComponent>[]
}

export type VizComponent = z.infer<typeof VisualizationComponent>

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
  parameters: z.object({
    title: z.string().describe("Overall title shown in the dialog header"),
    components: z
      .array(VisualizationComponent)
      .min(1)
      .max(8)
      .describe(
        "One or more visualization blocks. Use multiple components to build dashboards. " +
          "Tab-navigation is shown automatically when there are 2+ components.",
      ),
  }),
  async execute(params, _ctx) {
    return {
      title: params.title,
      output: `Visualization ready: "${params.title}" (${params.components.length} component${params.components.length === 1 ? "" : "s"})`,
      metadata: { spec: params, truncated: false },
    }
  },
})
