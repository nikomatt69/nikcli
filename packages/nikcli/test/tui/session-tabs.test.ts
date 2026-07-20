import { describe, expect, test } from "bun:test"
import { layoutSessionTabs, truncateTabTitle } from "@tui/component/session-tabs"

describe("session tab layout", () => {
  test("keeps all tabs visible when the terminal has room", () => {
    const result = layoutSessionTabs(["a", "b", "c"], "b", 100)

    expect(result.ids).toEqual(["a", "b", "c"])
    expect(result.hidden).toBe(0)
    expect(result.width).toBe(26)
  })

  test("keeps the active tab visible in a narrow terminal", () => {
    const result = layoutSessionTabs(["a", "b", "c", "d", "e"], "b", 50)

    expect(result.ids).toContain("b")
    expect(result.ids).toEqual(["b", "c"])
    expect(result.hidden).toBe(3)
    expect(result.width).toBe(12)
  })

  test("prioritizes the most recently opened tabs by default", () => {
    const result = layoutSessionTabs(["a", "b", "c", "d"], undefined, 40)

    expect(result.ids).toEqual(["d"])
    expect(result.hidden).toBe(3)
  })

  test("normalizes and truncates long titles", () => {
    expect(truncateTabTitle("  Search\n scrollback   bottom bar  ", 18)).toBe("Search scrollback…")
    expect(truncateTabTitle("   ", 20)).toBe("Untitled session")
    expect(Bun.stringWidth(truncateTabTitle("Design 🎨 session tabs", 12))).toBeLessThanOrEqual(12)
  })
})
