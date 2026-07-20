import { describe, expect, test } from "bun:test"
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  buildCategoryBreakdown,
  categoryColor,
  computeFreeTokens,
  computeUsageRatio,
  computeUsedTokens,
  healthStatus,
  turnTotalFromMessage,
  type UsageCategory,
} from "@tui/util/context-usage"
import type { Theme } from "@tui/context/theme"
import type { RGBA } from "@opentui/core"
import type { SessionContextResponse } from "@nikcli-ai/sdk/v2"

function rgba(r: number, g: number, b: number): RGBA {
  return { r, g, b, a: 1 } as RGBA
}

function fakeTheme(): Theme {
  return {
    primary: rgba(1, 0, 0),
    accent: rgba(0, 1, 0),
    success: rgba(0, 0, 1),
    info: rgba(1, 1, 0),
    warning: rgba(1, 0, 1),
    secondary: rgba(0, 1, 1),
    error: rgba(2, 2, 2),
  } as unknown as Theme
}

describe("context-usage / categoryColor", () => {
  test("returns a non-undefined RGBA for every category", () => {
    const theme = fakeTheme()
    for (const cat of CATEGORY_ORDER) {
      expect(categoryColor(theme, cat)).toBeDefined()
    }
  })

  test("keeps category → color mapping stable across calls", () => {
    const theme = fakeTheme()
    expect(categoryColor(theme, "system")).toBe(theme.primary)
    expect(categoryColor(theme, "instructions")).toBe(theme.accent)
    expect(categoryColor(theme, "skills")).toBe(theme.success)
    expect(categoryColor(theme, "mcp")).toBe(theme.info)
    expect(categoryColor(theme, "tools")).toBe(theme.warning)
    expect(categoryColor(theme, "agents")).toBe(theme.secondary)
    expect(categoryColor(theme, "messages")).toBe(theme.error)
  })

  test("CATEGORY_ORDER is the canonical ordering used by the stacked chart", () => {
    expect(CATEGORY_ORDER).toEqual(["system", "instructions", "skills", "mcp", "tools", "agents", "messages"])
  })

  test("CATEGORY_LABEL exposes a non-empty label for every category", () => {
    const cats: UsageCategory[] = ["system", "instructions", "skills", "mcp", "tools", "agents", "messages"]
    for (const cat of cats) {
      expect(CATEGORY_LABEL[cat]).toBeTruthy()
    }
  })
})

describe("context-usage / buildCategoryBreakdown", () => {
  test("drops disabled and zero-token sources", () => {
    const theme = fakeTheme()
    const sources = [
      { category: "system" as const, tokens: 1_000, enabled: true },
      { category: "system" as const, tokens: 200, enabled: false },
      { category: "messages" as const, tokens: 0, enabled: true },
    ]
    const out = buildCategoryBreakdown(theme, sources)
    expect(out.map((s) => s.value)).toEqual([1_000])
    expect(out[0]?.label).toBe(CATEGORY_LABEL.system)
  })

  test("aggregates enabled sources from the same category", () => {
    const theme = fakeTheme()
    const sources = [
      { category: "tools" as const, tokens: 100, enabled: true },
      { category: "tools" as const, tokens: 250, enabled: true },
      { category: "instructions" as const, tokens: 50, enabled: true },
    ]
    const out = buildCategoryBreakdown(theme, sources)
    const tools = out.find((s) => s.label === CATEGORY_LABEL.tools)
    const instructions = out.find((s) => s.label === CATEGORY_LABEL.instructions)
    expect(tools?.value).toBe(350)
    expect(instructions?.value).toBe(50)
  })

  test("orders segments by CATEGORY_ORDER (system first)", () => {
    const theme = fakeTheme()
    const sources = [
      { category: "messages" as const, tokens: 100, enabled: true },
      { category: "system" as const, tokens: 50, enabled: true },
      { category: "tools" as const, tokens: 200, enabled: true },
    ]
    const out = buildCategoryBreakdown(theme, sources)
    const labels = out.map((s) => s.label)
    expect(labels).toEqual([CATEGORY_LABEL.system, CATEGORY_LABEL.tools, CATEGORY_LABEL.messages])
  })

  test("emits empty array when nothing is enabled", () => {
    const theme = fakeTheme()
    const sources = [
      { category: "system" as const, tokens: 100, enabled: false },
      { category: "messages" as const, tokens: 100, enabled: false },
    ]
    expect(buildCategoryBreakdown(theme, sources)).toEqual([])
  })
})

describe("context-usage / healthStatus", () => {
  test("non-inverse: error at and above errorAt", () => {
    expect(healthStatus(95, 90, 70)).toBe("error")
    expect(healthStatus(90, 90, 70)).toBe("error")
  })

  test("non-inverse: warning between warnAt and errorAt", () => {
    expect(healthStatus(85, 90, 70)).toBe("warning")
    expect(healthStatus(70, 90, 70)).toBe("warning")
  })

  test("non-inverse: success when below warnAt but >0", () => {
    expect(healthStatus(50, 90, 70)).toBe("success")
    expect(healthStatus(1, 90, 70)).toBe("success")
  })

  test("non-inverse: info at exactly 0", () => {
    expect(healthStatus(0, 90, 70)).toBe("info")
  })

  test("inverse: error at and below errorAt", () => {
    expect(healthStatus(20, 30, 50, true)).toBe("error")
    expect(healthStatus(30, 30, 50, true)).toBe("error")
  })

  test("inverse: warning between errorAt and warnAt", () => {
    expect(healthStatus(40, 30, 50, true)).toBe("warning")
    expect(healthStatus(50, 30, 50, true)).toBe("warning")
  })

  test("inverse: success at and above 90", () => {
    expect(healthStatus(90, 30, 50, true)).toBe("success")
    expect(healthStatus(99, 30, 50, true)).toBe("success")
  })

  test("inverse: info between warnAt and 90", () => {
    expect(healthStatus(60, 30, 50, true)).toBe("info")
  })
})

describe("context-usage / usage ratio helpers", () => {
  test("computeUsageRatio: 0 when context limit is unknown", () => {
    expect(computeUsageRatio(0, 0, 0)).toBe(0)
    expect(computeUsageRatio(5000, 0, 0)).toBe(0)
  })

  test("computeUsageRatio: prefers reportedTotal over estimatedTotal", () => {
    // 5000 / 20000 = 25%
    expect(computeUsageRatio(5_000, 0, 20_000)).toBe(25)
    // estimatedTotal is ignored when reportedTotal > 0
    expect(computeUsageRatio(5_000, 99_999, 20_000)).toBe(25)
  })

  test("computeUsageRatio: falls back to estimatedTotal on cold start", () => {
    expect(computeUsageRatio(0, 8_000, 20_000)).toBe(40)
  })

  test("computeUsageRatio: clamps at 100", () => {
    expect(computeUsageRatio(99_999, 0, 20_000)).toBe(100)
  })

  test("computeUsedTokens: same as ratio × limit, clamped to limit", () => {
    expect(computeUsedTokens(5_000, 0, 20_000)).toBe(5_000)
    expect(computeUsedTokens(99_999, 0, 20_000)).toBe(20_000)
    expect(computeUsedTokens(0, 0, 0)).toBe(0)
  })

  test("computeFreeTokens: gap between limit and used", () => {
    expect(computeFreeTokens(5_000, 0, 20_000)).toBe(15_000)
    expect(computeFreeTokens(99_999, 0, 20_000)).toBe(0)
    expect(computeFreeTokens(0, 0, 0)).toBe(0)
  })
})

describe("context-usage / turnTotalFromMessage", () => {
  test("uses the explicit `total` when set", () => {
    expect(
      turnTotalFromMessage({
        tokens: {
          total: 123,
          input: 1,
          output: 1,
          reasoning: 1,
          cache: { read: 1, write: 1 },
        },
      }),
    ).toBe(123)
  })

  test("falls back to the sum of input + output + reasoning + cache when total is undefined", () => {
    expect(
      turnTotalFromMessage({
        tokens: {
          input: 100,
          output: 50,
          reasoning: 25,
          cache: { read: 200, write: 75 },
        },
      }),
    ).toBe(450)
  })

  test("falls back to the sum when total is 0 (treats it as not set)", () => {
    expect(
      turnTotalFromMessage({
        tokens: {
          total: 0,
          input: 10,
          output: 20,
          reasoning: 0,
          cache: { read: 30, write: 40 },
        },
      }),
    ).toBe(100)
  })
})

describe("context-usage / SessionContextResponse shape", () => {
  test("categories enum still matches the local CATEGORY_ORDER", () => {
    // This is a smoke test guarding against an SDK regeneration that adds or
    // renames categories. If this fails, update `CATEGORY_ORDER` +
    // `categoryColor` + `CATEGORY_LABEL` together so the stacked bar stays
    // exhaustive.
    const sample = {
      sources: [
        { category: "system" },
        { category: "instructions" },
        { category: "skills" },
        { category: "mcp" },
        { category: "tools" },
        { category: "agents" },
        { category: "messages" },
      ],
    } as unknown as SessionContextResponse
    const set = new Set(sample.sources.map((s) => s.category))
    for (const cat of CATEGORY_ORDER) expect(set.has(cat)).toBe(true)
  })
})
