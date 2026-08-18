import { Tool } from "./tool"
import { SafeVizSpecZod, VizCatalog, countFlatComponents, type VizComponent } from "@nikcli-ai/util/viz"

// The catalog, schemas and codec live in @nikcli-ai/util/viz; re-exported so existing importers
// of this module keep resolving.
export * from "@nikcli-ai/util/viz"

export const OpenTUIVizTool = Tool.define("opentui", {
  description: VizCatalog.prompt(),
  // Use the parser-safe schema so wrapped tool-call payloads (e.g. `{item: ...}`)
  // validate cleanly. See SafeVizSpecZod for the full rationale.
  parameters: SafeVizSpecZod,
  async execute(params, _ctx) {
    // SAFETY: `SafeVizSpecZod` (see the note above) already validated the
    // payload; the assertion only restores the component union that the
    // parser-safe schema widens.
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
