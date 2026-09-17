import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

/**
 * The sections box must not take the column's leftover height.
 *
 * Read from the stylesheet because this is a rule about layout, not about a
 * value any module exports: with `flex: 1` the box ran to the foot of the
 * sidebar, so a shut "File" section left half the column an empty card.
 */
const css = readFileSync(new URL("./sidebar.css", import.meta.url), "utf8")

/** The declarations of one rule, with comments stripped so a note cannot pass for code. */
function ruleBody(selector: string): string {
  const start = css.indexOf(`${selector} {`)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = css.indexOf("}", start)
  return css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "")
}

describe("the sidebar sections box", () => {
  test("is sized to its content, not to the column", () => {
    const body = ruleBody('[data-slot="sidebar-sections"]')
    expect(body).toContain("flex: 0 1 auto")
    expect(body).not.toMatch(/flex:\s*1\s*;/)
    expect(body).not.toMatch(/flex-grow:\s*[1-9]/)
  })

  test("can still shrink, so the scrolling section keeps working", () => {
    expect(ruleBody('[data-slot="sidebar-sections"]')).toContain("min-height: 0")
  })
})
