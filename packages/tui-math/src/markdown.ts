/**
 * Turning a markdown message into renderable blocks.
 *
 * A terminal message is a vertical stack, so display math is simply a block of
 * its own between two runs of markdown. Inline math is the interesting case:
 * it has to stay *inside* the sentence, which means it cannot be a separate
 * renderable at all — it has to become text.
 *
 * That works because most inline math is one row tall once laid out: `$x^2$`
 * is `x²`, `$\alpha_i$` is `αᵢ`, `$\sum_{i}$` is `∑ᵢ`. Those are substituted
 * straight into the markdown source and flow with the paragraph. A formula
 * that needs more rows — an inline `\frac`, a matrix — cannot be inlined
 * without shredding the line box, so it is promoted to its own block, which
 * splits the sentence but keeps the formula readable.
 *
 * Substituted text re-enters the markdown parser, and it cannot be protected
 * on the way in: a renderer that conceals syntax markers deletes the markers
 * rather than the backslashes in front of them, so `\[x\]` paints as `\x\`
 * and `[x]` paints as `x`. Escaping makes things worse, not better.
 *
 * So a formula is only substituted when its rendered glyphs are provably
 * inert as markdown — see {@link isMarkdownSafe}. Anything else is promoted
 * to a block, where the cells are painted directly and no parser is
 * involved. Most math is inert: the renderer emits `∗` for `\ast` and `∼`
 * for `\sim`, and superscripts and Greek letters have no markdown meaning at
 * all. Brackets are the common exception.
 */
import { splitMathSegments, type SplitMathOptions } from "./detect"
import { flattenInline } from "./inline"
import { layoutMath } from "./layout"
import { parseLatex } from "./parser"
import type { MathLayout, RenderLatexOptions } from "./types"

export type MathBlock = { type: "markdown"; content: string } | { type: "math"; content: string; display: boolean }

export interface BuildMathBlocksOptions extends SplitMathOptions {
  /**
   * Tallest layout still substituted into a paragraph. Anything taller is
   * promoted to its own block. Set to `0` to promote all inline math.
   */
  inlineHeightLimit?: number
  /** Options forwarded to the layout engine for inline substitution. */
  renderOptions?: RenderLatexOptions
  /**
   * Retry a too-tall inline formula in its running-text spelling (`a/b`,
   * `√x`) before giving up and promoting it to a block. Defaults to `true`.
   */
  flattenInline?: boolean
}

/**
 * Characters a markdown renderer pairs up and then hides.
 *
 * Deliberately narrower than CommonMark's full punctuation set: `|`, `<`,
 * `>`, `#` and `&` survive a paragraph render untouched, and excluding them
 * keeps `P(A ∣ B)`, `x > 0` and `a|b` inline where they belong.
 */
const MARKDOWN_ACTIVE = /[\\`*_[\]~]/

/**
 * Split a markdown message into markdown and math blocks.
 *
 * A message without math returns a single markdown block holding the input
 * verbatim — the common case costs one delimiter scan and nothing else.
 */
export function buildMathBlocks(input: string, options: BuildMathBlocksOptions = {}): MathBlock[] {
  if (!input) return []
  const segments = splitMathSegments(input, options)
  if (!segments.some((segment) => segment.type === "math")) {
    return [{ type: "markdown", content: input }]
  }

  const inlineHeightLimit = options.inlineHeightLimit ?? 1
  const renderOptions = options.renderOptions ?? {}
  const flatten = options.flattenInline ?? true
  const blocks: MathBlock[] = []
  let buffer = ""

  const flush = () => {
    const content = trimBlankEdges(buffer)
    buffer = ""
    if (content) blocks.push({ type: "markdown", content })
  }

  for (const segment of segments) {
    if (segment.type === "text") {
      buffer += segment.value
      continue
    }
    if (!segment.display) {
      const inline = inlineText(segment.value, inlineHeightLimit, renderOptions, flatten)
      if (inline !== undefined) {
        buffer += inline
        continue
      }
    }
    flush()
    blocks.push({ type: "math", content: segment.value, display: segment.display })
  }

  flush()
  return blocks
}

/**
 * Lay a formula out on one row and escape it for re-parsing, or return
 * `undefined` when it does not fit on one row (or fails to render at all).
 *
 * A formula that is too tall as written gets a second chance in its
 * running-text spelling before the caller gives up and promotes it.
 */
function inlineText(
  latex: string,
  heightLimit: number,
  renderOptions: RenderLatexOptions,
  flatten: boolean,
): string | undefined {
  if (heightLimit < 1) return undefined
  const layoutOptions: RenderLatexOptions = {
    ...renderOptions,
    displayMode: false,
    compactScripts: true,
  }

  let layout: MathLayout
  try {
    const node = parseLatex(latex, layoutOptions)
    layout = layoutMath(node, layoutOptions)
    if (layout.height > heightLimit && flatten) {
      layout = layoutMath(flattenInline(node), layoutOptions)
    }
  } catch {
    return undefined
  }

  if (layout.height > heightLimit) return undefined
  const text = layout.toString().trim()
  if (!text || !isMarkdownSafe(text)) return undefined
  return text
}

/**
 * Whether rendered math can be dropped into a paragraph unchanged.
 *
 * False for anything holding a character the markdown renderer would treat
 * as syntax and conceal — `\left[x\right]` renders as `[x]`, which a
 * paragraph would paint as a bare `x`. Such a formula is rendered as a block
 * instead, which costs a line break but never loses a glyph.
 */
export function isMarkdownSafe(value: string): boolean {
  return !MARKDOWN_ACTIVE.test(value)
}

/** Drop the blank lines a block inherited from the delimiters around it. */
function trimBlankEdges(value: string): string {
  return value.replace(/^[ \t]*\n+/, "").replace(/\n+[ \t]*$/, "")
}
