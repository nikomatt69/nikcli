/**
 * @nikcli-ai/tui-math
 *
 * LaTeX math rendering for OpenTUI terminals, vendored into nikcli so the
 * feature ships by default with no npm dependency and no TeX installation.
 *
 * The renderer is a math-mode engine, not a TeX engine: it parses a formula
 * into a {@link MathNode} tree, lays that tree out on a character grid with a
 * baseline, and paints the grid into an OpenTUI buffer. Every terminal
 * OpenTUI supports can display the result — the glyphs are plain Unicode, so
 * there is no graphics-protocol probe, no rasterizer and no image transfer.
 *
 * ```ts
 * import { renderLatexToString } from "@nikcli-ai/tui-math"
 *
 * renderLatexToString(String.raw`x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}`)
 * ```
 *
 * ```text
 *            ╭────────
 *      -b ± √ b² - 4ac
 * x = ─────────────────
 *            2a
 * ```
 *
 * For the TUI, {@link LatexRenderable} measures itself through Yoga and
 * repaints in place when `content` changes, and {@link LatexStreamController}
 * absorbs the temporarily-invalid prefixes that arrive while a model streams
 * a formula token by token.
 *
 * Derived from opentui-math (MIT, https://github.com/neriousy/opentui-math);
 * see LICENSE for the upstream copyright notice.
 */
export { parseLatex } from "./parser"
export { layoutMath } from "./layout"
export { renderLatex, renderLatexToString } from "./render"
export { LatexRenderable, type LatexRenderableOptions } from "./renderable"
export {
  completeLatexPrefix,
  LatexStreamController,
  type LatexStreamOptions,
  type LatexStreamResult,
  type LatexStreamTarget,
} from "./stream"
export {
  hasMathDelimiter,
  splitMathSegments,
  type MathSegment,
  type SplitMathOptions,
} from "./detect"
export {
  buildMathBlocks,
  isMarkdownSafe,
  type BuildMathBlocksOptions,
  type MathBlock,
} from "./markdown"
export { flattenInline } from "./inline"
export { LatexParseError } from "./types"
export type {
  AccentKind,
  MathCell,
  MathLayout,
  MathNode,
  MathStyle,
  MathVariant,
  MatrixEnvironment,
  ParseOptions,
  RenderLatexOptions,
  SymbolRole,
} from "./types"
