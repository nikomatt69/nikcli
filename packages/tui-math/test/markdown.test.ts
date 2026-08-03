import { describe, expect, test } from "bun:test"
import { buildMathBlocks, isMarkdownSafe, renderLatexToString } from "../src/index"

describe("buildMathBlocks", () => {
  test("returns the message verbatim when it has no math", () => {
    expect(buildMathBlocks("# Title\n\nsome prose")).toEqual([{ type: "markdown", content: "# Title\n\nsome prose" }])
    expect(buildMathBlocks("")).toEqual([])
  })

  test("substitutes one-row inline math into the sentence", () => {
    const blocks = buildMathBlocks("The area is $\\pi r^2$ exactly.")
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ type: "markdown" })
    const content = (blocks[0] as { content: string }).content
    expect(content).toStartWith("The area is ")
    expect(content).toEndWith(" exactly.")
    expect(content).toContain("π")
    expect(content).toContain("²")
    expect(content).not.toContain("$")
  })

  test("promotes display math to its own block", () => {
    const blocks = buildMathBlocks("before\n\n$$\\frac{a}{b}$$\n\nafter")
    expect(blocks).toEqual([
      { type: "markdown", content: "before" },
      { type: "math", content: "\\frac{a}{b}", display: true },
      { type: "markdown", content: "after" },
    ])
  })

  test("promotes inline math that needs more than one row", () => {
    // A stacked binomial has no running-text spelling, so it cannot be
    // flattened into the sentence the way a fraction can.
    const latex = String.raw`\binom{n}{k}`
    expect(buildMathBlocks(`we get $${latex}$ here`)).toEqual([
      { type: "markdown", content: "we get " },
      { type: "math", content: latex, display: false },
      { type: "markdown", content: " here" },
    ])
  })

  test("inlineHeightLimit controls promotion", () => {
    const tall = buildMathBlocks(String.raw`we get $\binom{n}{k}$ here`, { inlineHeightLimit: 3 })
    expect(tall).toHaveLength(1)
    expect(tall[0]!.type).toBe("markdown")

    const none = buildMathBlocks("the value $x$ here", { inlineHeightLimit: 0 })
    expect(none.filter((block) => block.type === "math")).toHaveLength(1)
  })

  test("keeps a math-only message as a single math block", () => {
    expect(buildMathBlocks("$$E = mc^2$$")).toEqual([{ type: "math", content: "E = mc^2", display: true }])
  })

  test("handles several display blocks in a row", () => {
    const blocks = buildMathBlocks("$$a$$\n\n$$b$$")
    expect(blocks).toEqual([
      { type: "math", content: "a", display: true },
      { type: "math", content: "b", display: true },
    ])
  })

  test("leaves fenced code untouched", () => {
    const input = ["intro", "```sh", "echo $HOME", "```", "outro"].join("\n")
    expect(buildMathBlocks(input)).toEqual([{ type: "markdown", content: input }])
  })

  test("promotes an inline matrix rather than mangling the line", () => {
    const blocks = buildMathBlocks(String.raw`a \(\begin{pmatrix}a & b \\ c & d\end{pmatrix}\) b`)
    expect(blocks.filter((block) => block.type === "math")).toHaveLength(1)
  })

  test("preserves the prose around promoted math", () => {
    const blocks = buildMathBlocks("Given\n\n$$x$$\n\nwe conclude $y$ holds.")
    expect(blocks[0]).toEqual({ type: "markdown", content: "Given" })
    expect(blocks[1]).toEqual({ type: "math", content: "x", display: true })
    expect((blocks[2] as { content: string }).content).toStartWith("we conclude ")
  })
})

describe("isMarkdownSafe", () => {
  test("rejects the characters a paragraph would conceal", () => {
    expect(isMarkdownSafe("a*b")).toBe(false)
    expect(isMarkdownSafe("[x]")).toBe(false)
    expect(isMarkdownSafe("f`g")).toBe(false)
    expect(isMarkdownSafe("p~q")).toBe(false)
    expect(isMarkdownSafe("x_i")).toBe(false)
  })

  test("accepts math glyphs and the punctuation that survives a paragraph", () => {
    expect(isMarkdownSafe("π r² = ∑ ∫ √ ± ×")).toBe(true)
    expect(isMarkdownSafe("P(A ∣ B)")).toBe(true)
    expect(isMarkdownSafe("x > 0")).toBe(true)
    expect(isMarkdownSafe("a|b")).toBe(true)
    expect(isMarkdownSafe("1/6")).toBe(true)
  })

  test("the renderer spells risky commands with inert glyphs", () => {
    // `\ast` is U+2217 and `\sim` is U+223C, not the ASCII markdown markers.
    expect(isMarkdownSafe(renderLatexToString(String.raw`a \ast b`, { displayMode: false }))).toBe(true)
    expect(isMarkdownSafe(renderLatexToString(String.raw`x \sim y`, { displayMode: false }))).toBe(true)
  })

  test("a bracketed formula is promoted rather than substituted", () => {
    const blocks = buildMathBlocks(String.raw`the interval \(\left[0,1\right]\) is closed`)
    expect(blocks.filter((block) => block.type === "math")).toHaveLength(1)
  })
})
