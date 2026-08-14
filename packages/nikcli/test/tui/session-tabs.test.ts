import { describe, expect, test } from "bun:test"
import { layoutSessionTabs, showsCloseAll, truncateTabTitle } from "@tui/component/session-tabs"

describe("session tab layout", () => {
  test("keeps all tabs visible when the terminal has room", () => {
    const result = layoutSessionTabs(["a", "b", "c"], "b", 100)

    expect(result.ids).toEqual(["a", "b", "c"])
    expect(result.hidden).toBe(0)
    expect(result.width).toBe(23)
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

  test("reserves the close-all button's cells when it is shown", () => {
    // The button is chrome: whatever it occupies has to come off the tabs, or they render past
    // the right edge of the terminal.
    expect(showsCloseAll(3, 100)).toBe(true)
    const shown = layoutSessionTabs(["a", "b", "c"], "b", 100)
    const hypothetical = Math.floor((100 - 17 - 2) / 3) - 1

    expect(shown.width).toBe(hypothetical - Math.ceil(7 / 3))
  })

  test("hides the close-all button rather than spend a tab on it", () => {
    expect(showsCloseAll(5, 50)).toBe(false)
    // Same result as before the button existed, so narrow terminals lose nothing.
    expect(layoutSessionTabs(["a", "b", "c", "d", "e"], "b", 50).ids).toEqual(["b", "c"])
  })

  test("shows no close-all button with nothing open", () => {
    expect(showsCloseAll(0, 200)).toBe(false)
  })

  test("normalizes and truncates long titles", () => {
    expect(truncateTabTitle("  Search\n scrollback   bottom bar  ", 18)).toBe("Search scrollback…")
    expect(truncateTabTitle("   ", 20)).toBe("Untitled session")
    expect(Bun.stringWidth(truncateTabTitle("Design 🎨 session tabs", 12))).toBeLessThanOrEqual(12)
  })
})
