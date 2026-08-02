import { describe, expect, test } from "bun:test"
import { buildMathBlocks, flattenInline, layoutMath, parseLatex } from "../src/index"

function flat(latex: string): string {
  return layoutMath(flattenInline(parseLatex(latex)), { displayMode: false }).toString().trim()
}

function inlineOf(message: string, options?: Parameters<typeof buildMathBlocks>[1]): string | undefined {
  const blocks = buildMathBlocks(message, options)
  if (blocks.length !== 1 || blocks[0]!.type !== "markdown") return undefined
  return blocks[0]!.content
}

describe("flattenInline", () => {
  test("writes a fraction as a division", () => {
    expect(flat(String.raw`\frac{1}{6}`)).toBe("1/6")
  })

  test("parenthesizes compound operands", () => {
    expect(flat(String.raw`\frac{a+b}{2}`)).toBe("(a + b)/2")
    expect(flat(String.raw`\frac{1}{n+1}`)).toBe("1/(n + 1)")
  })

  test("does not double up on existing brackets", () => {
    expect(flat(String.raw`\frac{(a+b)}{2}`)).toBe("(a + b)/2")
  })

  test("drops the vinculum from a square root", () => {
    expect(flat(String.raw`\sqrt{2}`)).toBe("√2")
    expect(flat(String.raw`\sqrt{x+1}`)).toBe("√(x + 1)")
  })

  test("keeps a product in a numerator unbracketed", () => {
    expect(flat(String.raw`\frac{n(n+1)}{2}`)).toBe("n(n + 1)/2")
    expect(flat(String.raw`\frac{x^2}{y^2}`)).toBe("x²/y²")
  })

  test("brackets a multi-term denominator", () => {
    // `1/σ√2π` would read as `(1/σ)·√2·π`; nothing in the notation settles it.
    expect(flat(String.raw`\frac{1}{\sigma\sqrt{2\pi}}`)).toBe("1/(σ√(2π))")
    expect(flat(String.raw`\frac{-b}{2a}`)).toBe("-b/(2a)")
  })

  test("brackets a multi-term radicand", () => {
    expect(flat(String.raw`\sqrt{2\pi}`)).toBe("√(2π)")
    expect(flat(String.raw`\frac{1}{\sqrt{2}}`)).toBe("1/√2")
  })

  test("brackets a relation or a sum wherever it appears", () => {
    expect(flat(String.raw`\frac{a=b}{2}`)).toBe("(a = b)/2")
    expect(flat(String.raw`\frac{2\frac{a}{b}}{3}`)).toBe("(2a/b)/3")
  })

  test("treats a leading sign as part of the term", () => {
    expect(flat(String.raw`\frac{-b}{2}`)).toBe("-b/2")
  })

  test("keeps a binomial stacked", () => {
    const layout = layoutMath(flattenInline(parseLatex(String.raw`\binom{n}{k}`)), { displayMode: false })
    expect(layout.height).toBeGreaterThan(1)
  })

  test("keeps an indexed root as written", () => {
    const layout = layoutMath(flattenInline(parseLatex(String.raw`\sqrt[3]{x}`)), { displayMode: false })
    expect(layout.height).toBeGreaterThan(1)
  })

  test("recurses into nested constructs", () => {
    expect(flat(String.raw`\frac{\sqrt{2}}{2}`)).toBe("√2/2")
    expect(flat(String.raw`x^{\frac{1}{2}}`)).toContain("/")
  })

  test("leaves a formula with no stacked construct untouched", () => {
    expect(flat(String.raw`a + b = c`)).toBe(layoutMath(parseLatex(String.raw`a + b = c`), { displayMode: false }).toString().trim())
  })
})

describe("buildMathBlocks with flattening", () => {
  test("keeps an inline fraction inside the sentence", () => {
    const content = inlineOf("the probability is $\\frac{1}{6}$ per roll")
    expect(content).toBe("the probability is 1/6 per roll")
  })

  test("keeps an inline square root inside the sentence", () => {
    expect(inlineOf(String.raw`the diagonal is \(\sqrt{2}\) units`)).toBe("the diagonal is √2 units")
  })

  test("still promotes what cannot be flattened", () => {
    const blocks = buildMathBlocks(String.raw`a matrix \(\begin{pmatrix}a & b \\ c & d\end{pmatrix}\) here`)
    expect(blocks.some((block) => block.type === "math")).toBe(true)
  })

  test("a one-row matrix needs no promotion", () => {
    const blocks = buildMathBlocks(String.raw`the vector \(\begin{pmatrix}a & b\end{pmatrix}\) here`)
    expect(blocks.every((block) => block.type === "markdown")).toBe(true)
  })

  test("flattenInline: false restores promotion", () => {
    const blocks = buildMathBlocks("the probability is $\\frac{1}{6}$ per roll", { flattenInline: false })
    expect(blocks.some((block) => block.type === "math")).toBe(true)
  })

  test("display math is never flattened", () => {
    const blocks = buildMathBlocks(String.raw`$$\frac{1}{6}$$`)
    expect(blocks).toEqual([{ type: "math", content: String.raw`\frac{1}{6}`, display: true }])
  })
})
