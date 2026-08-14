import type { RGBA } from "@opentui/core"
import type { Theme } from "../context/theme"
import type { SessionContextResponse } from "@nikcli-ai/sdk/httpapi"

/**
 * Helpers used by the context-usage dialog to render charts, gauges, and the
 * health grid. Kept dependency-free (no Solid/OpenTUI imports) so they can be
 * unit-tested in isolation — mirroring the layout of `analytics-utils.ts`.
 */

export type UsageCategory = SessionContextResponse["sources"][number]["category"]

export const CATEGORY_ORDER: UsageCategory[] = [
  "system",
  "instructions",
  "skills",
  "mcp",
  "tools",
  "agents",
  "messages",
]

export const CATEGORY_LABEL: Record<UsageCategory, string> = {
  system: "System prompt",
  instructions: "Instructions",
  skills: "Skills · /skills",
  mcp: "MCP servers · /mcp",
  tools: "Tools",
  agents: "Agents · /agents",
  messages: "Conversation",
}

/**
 * Pick a stable semantic color per category so the stacked composition bar
 * stays readable across themes. Order is meaningful: categories rendered
 * first get the more saturated hues, later ones get the desaturated ones.
 */
export function categoryColor(theme: Theme, cat: UsageCategory): RGBA {
  switch (cat) {
    case "system":
      return theme.accent.fg
    case "instructions":
      return theme.accent.alt
    case "skills":
      return theme.status.success.fg
    case "mcp":
      return theme.status.info.fg
    case "tools":
      return theme.status.warning.fg
    case "agents":
      return theme.accent.secondary
    case "messages":
      return theme.status.error.fg
  }
}

export type HealthStatus = "info" | "success" | "warning" | "error"

/**
 * Health verdict for a single metric. `inverse=true` flips the polarity so
 * `errorAt`/`warnAt` describe *bad* thresholds (cache hit rate is *better*
 * when high; the same function with `inverse=true` will label 30% as
 * "error" because it's below the threshold).
 */
export function healthStatus(value: number, errorAt: number, warnAt: number, inverse = false): HealthStatus {
  if (inverse) {
    if (value <= errorAt) return "error"
    if (value <= warnAt) return "warning"
    return value >= 90 ? "success" : "info"
  }
  if (value >= errorAt) return "error"
  if (value >= warnAt) return "warning"
  return value > 0 ? "success" : "info"
}

export interface CategorySegment {
  label: string
  value: number
  color: RGBA
}

/**
 * Aggregate enabled sources by category and emit a list of segments sorted
 * by `CATEGORY_ORDER`. Zero-token and disabled categories are dropped so the
 * stacked bar doesn't waste cells on empty buckets.
 */
export function buildCategoryBreakdown(
  theme: Theme,
  sources: ReadonlyArray<Pick<SessionContextResponse["sources"][number], "category" | "tokens" | "enabled">>,
): CategorySegment[] {
  const acc = new Map<UsageCategory, number>()
  for (const source of sources) {
    if (!source.enabled) continue
    acc.set(source.category, (acc.get(source.category) ?? 0) + source.tokens)
  }
  const out: CategorySegment[] = []
  for (const cat of CATEGORY_ORDER) {
    const value = acc.get(cat) ?? 0
    if (value <= 0) continue
    out.push({
      label: CATEGORY_LABEL[cat],
      value,
      color: categoryColor(theme, cat),
    })
  }
  return out
}

/**
 * Headline ratio helpers used by the KPI cards and the pressure gauge.
 * Returned as plain numbers so callers can format them with `Usage.format*`.
 */
export function computeUsageRatio(reportedTotal: number, estimatedTotal: number, contextLimit: number): number {
  if (contextLimit <= 0) return 0
  const total = reportedTotal > 0 ? reportedTotal : estimatedTotal
  return Math.min(100, (total / contextLimit) * 100)
}

export function computeUsedTokens(reportedTotal: number, estimatedTotal: number, contextLimit: number): number {
  const total = reportedTotal > 0 ? reportedTotal : estimatedTotal
  if (contextLimit <= 0) return total
  return Math.min(total, contextLimit)
}

export function computeFreeTokens(reportedTotal: number, estimatedTotal: number, contextLimit: number): number {
  if (contextLimit <= 0) return 0
  return Math.max(0, contextLimit - computeUsedTokens(reportedTotal, estimatedTotal, contextLimit))
}

/**
 * Per-turn token series helpers. Both `total` and the input+output+cache
 * fallbacks are normalized the same way the parent reducer in `app.tsx`
 * normalizes them, so sparklines rendered from this helper always match
 * the headline numbers in the KPI cards.
 */
export function turnTotalFromMessage(message: {
  tokens: {
    total?: number
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
}): number {
  const t = message.tokens
  if (t.total && t.total > 0) return t.total
  return t.input + t.output + t.reasoning + t.cache.read + t.cache.write
}
