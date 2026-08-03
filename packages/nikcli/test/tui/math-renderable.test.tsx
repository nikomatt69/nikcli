import { describe, expect, test } from "bun:test"
import { RGBA, SyntaxStyle, type CapturedFrame } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { buildMathBlocks, isMarkdownSafe, renderLatexToString } from "@nikcli-ai/tui-math"
import "@nikcli-ai/tui-math/solid"

const FG = RGBA.fromInts(255, 255, 255, 255)
const BG = RGBA.fromInts(0, 0, 0, 255)

/** The painted grid, trailing blanks trimmed, as one string per row. */
function paint(captureSpans: () => CapturedFrame): string[] {
  return captureSpans()
    .lines.map((line) =>
      line.spans
        .map((span) => span.text)
        .join("")
        .replace(/\s+$/, ""),
    )
    .filter((line) => line.trim().length > 0)
}

describe("<nikcli_latex>", () => {
  test("paints a formula through the Solid intrinsic", async () => {
    const { captureSpans, renderOnce } = await testRender(
      () => (
        <box width={40} height={6} backgroundColor={BG}>
          <nikcli_latex content={String.raw`x = \frac{a}{b}`} foregroundColor={FG} displayMode={true} />
        </box>
      ),
      { width: 40, height: 6 },
    )
    await renderOnce()

    const lines = paint(captureSpans)
    expect(lines.join("\n")).toContain("─")
    expect(lines.some((line) => line.includes("a"))).toBe(true)
    expect(lines.some((line) => line.includes("b"))).toBe(true)
    // The whole formula, not a single squashed row.
    expect(lines.length).toBeGreaterThan(1)
  })

  test("repaints in place when the content changes", async () => {
    const [content, setContent] = createSignal(String.raw`\alpha`)
    const { captureSpans, renderOnce } = await testRender(
      () => (
        <box width={30} height={4} backgroundColor={BG}>
          <nikcli_latex content={content()} foregroundColor={FG} />
        </box>
      ),
      { width: 30, height: 4 },
    )
    await renderOnce()
    expect(paint(captureSpans).join("")).toContain("α")

    setContent(String.raw`\beta`)
    await renderOnce()
    const after = paint(captureSpans).join("")
    expect(after).toContain("β")
    expect(after).not.toContain("α")
  })

  /**
   * The reconciler assigns JSX attributes after construction, so `fallback`
   * only works if the renderable exposes it as a settable property. Without
   * that, a half-streamed formula shows "LaTeX error: …" instead of the
   * source the caller asked for.
   */
  test("honours the fallback prop assigned by the reconciler", async () => {
    const { captureSpans, renderOnce } = await testRender(
      () => (
        <box width={40} height={4} backgroundColor={BG}>
          <nikcli_latex content={String.raw`\begin{pmatrix}`} foregroundColor={FG} fallback="source" />
        </box>
      ),
      { width: 40, height: 4 },
    )
    await renderOnce()
    const painted = paint(captureSpans).join("")
    expect(painted).toContain("begin")
    expect(painted).not.toContain("LaTeX error")
  })
})

describe("inline substitution through the markdown renderer", () => {
  /**
   * Inline formulas are substituted into the markdown source as plain text,
   * so they have to survive a real parse. A glyph the renderer reads as
   * syntax would be concealed and silently drop out of the sentence.
   */
  async function render(content: string) {
    const { captureSpans, renderOnce } = await testRender(
      () => (
        <box width={60} height={4} backgroundColor={BG}>
          <markdown content={content} syntaxStyle={SyntaxStyle.create()} fg={FG} />
        </box>
      ),
      { width: 60, height: 4 },
    )
    for (let attempt = 0; attempt < 50; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 20))
      await renderOnce()
      const output = paint(captureSpans).join("\n")
      if (output) return output
    }
    return ""
  }

  /**
   * The reason substitution is gated on {@link isMarkdownSafe} rather than on
   * escaping: this renderer deletes the marker and keeps the backslash, so
   * there is no way to spell these characters inside a paragraph. If this
   * ever starts passing, inline substitution can be widened.
   */
  test("markdown-active characters are unspellable in a paragraph", async () => {
    expect(await render("a*b*c")).toContain("abc")
    expect(await render("v[1]")).toContain("v1")
    expect(await render("a\\*b\\*c")).toContain("a\\*b\\*c")
    expect(isMarkdownSafe("a*b*c")).toBe(false)
    expect(isMarkdownSafe("v[1]")).toBe(false)
  })

  test("a substituted formula survives the round trip", async () => {
    const blocks = buildMathBlocks("the sum $\\sum_{i=1}^{n} i$ counts")
    expect(blocks).toHaveLength(1)
    const painted = await render((blocks[0] as { content: string }).content)
    expect(painted).toContain("the sum")
    expect(painted).toContain("counts")
    expect(painted).toContain("∑")
  })

  test("math glyphs pass through untouched", async () => {
    const formula = renderLatexToString(String.raw`\pi r^2`, { displayMode: false }).trim()
    expect(isMarkdownSafe(formula)).toBe(true)
    expect(await render(formula)).toContain(formula)
  })

  test("every safe formula in a realistic corpus paints unchanged", async () => {
    const corpus = [
      String.raw`x^2`,
      String.raw`\pi r^2`,
      String.raw`\frac{1}{6}`,
      String.raw`\sqrt{2}`,
      String.raw`\theta_{t+1}`,
      String.raw`a \ast b`,
      String.raw`x \sim y`,
      String.raw`P(A \mid B)`,
    ]
    for (const latex of corpus) {
      const blocks = buildMathBlocks(`start $${latex}$ end`)
      if (blocks.length !== 1 || blocks[0]!.type !== "markdown") continue
      const source = blocks[0]!.content
      const painted = await render(source)
      expect(painted).toBe(source)
    }
  })
})
