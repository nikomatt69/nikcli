# @nikcli-ai/tui-math

LaTeX math rendering for NikCLI and OpenTUI applications.

The package parses a formula, lays it out on a character grid with a baseline,
and paints that grid into an OpenTUI buffer. The glyphs are plain Unicode, so
every terminal OpenTUI supports can display the result — there is no graphics
protocol to probe, no rasterizer, and no TeX installation involved.

```text
           ╭────────
     -b ± √ b² - 4ac
x = ─────────────────
           2a
```

Derived from [opentui-math](https://github.com/neriousy/opentui-math) (MIT),
vendored rather than depended on so the feature ships with the binary. The
high-resolution MathJax/Kitty backend from upstream is not part of this port:
it needs `mathjax` and a rasterizer, and the cell renderer is what makes the
feature universal.

## Render A Formula

```ts
import { renderLatexToString } from "@nikcli-ai/tui-math"

console.log(renderLatexToString(String.raw`\begin{pmatrix}a & b \\ c & d\end{pmatrix}`))
```

```text
⎛a b⎞
⎜   ⎟
⎝c d⎠
```

`renderLatex()` returns `{ width, height, baseline, cells, toString() }` for
tests and custom composition.

## In A TUI

`LatexRenderable` measures itself through Yoga and repaints in place when its
`content` changes. Importing the Solid entry point registers `<nikcli_latex>`:

```tsx
import "@nikcli-ai/tui-math/solid"

;<nikcli_latex content={String.raw`\int_0^\infty e^{-x}\,dx = 1`} foregroundColor="#cdd6f4" />
```

| Option | Default | Purpose |
| --- | --- | --- |
| `content` | `""` | LaTeX math source |
| `foregroundColor` | `#e8e8f0` | Formula color |
| `backgroundColor` | transparent | Formula background |
| `displayMode` | `true` | Put limits above and below large operators |
| `compactScripts` | `true` | Use Unicode super/subscripts where exact glyphs exist |
| `macros` | `{}` | Expand lightweight user command macros |
| `strict` | `false` | Throw on unknown commands |
| `fallback` | `"message"` | Error behavior: `"message"`, `"source"`, or `"throw"` |
| `errorColor` | `#ff6b6b` | Fallback error color |

## Math In Prose

`buildMathBlocks()` is what makes math work on an ordinary assistant message.
It finds formulas in markdown and splits the message into blocks the caller
renders with its own markdown renderer and this one:

```ts
import { buildMathBlocks } from "@nikcli-ai/tui-math"

buildMathBlocks("The probability is $\\frac{1}{6}$ per roll.")
// [{ type: "markdown", content: "The probability is 1/6 per roll." }]

buildMathBlocks("Solve:\n\n$$x^2 + 1 = 0$$")
// [{ type: "markdown", content: "Solve:" },
//  { type: "math", content: "x^2 + 1 = 0", display: true }]
```

Recognized delimiters are `$…$`, `$$…$$`, `\(…\)`, `\[…\]`, and bare math
environments such as `\begin{align}`. Fenced blocks and inline code spans are
masked out first, and `$…$` additionally has to satisfy the TeX-ish delimiter
rules and parse strictly — so `$5 to $10`, `set $PATH and $HOME`, and shell
snippets stay text.

Inline formulas are substituted into the sentence when they lay out on one
row, using the running-text spelling where one exists (`\frac{1}{6}` becomes
`1/6`, `\sqrt{2}` becomes `√2`, with brackets added wherever flattening would
be ambiguous). Anything else — a matrix, a binomial, an accent — becomes its
own block rather than breaking the line box.

| Option | Default | Purpose |
| --- | --- | --- |
| `inlineHeightLimit` | `1` | Tallest layout still substituted into a paragraph |
| `flattenInline` | `true` | Retry a tall inline formula as `a/b`, `√x` |
| `maxLength` | `4000` | Longest accepted formula body |
| `inline` / `display` | `true` | Recognize inline / display delimiters |

Substituted text re-enters a markdown parser, which cannot be escaped against
reliably — a renderer that conceals syntax markers deletes the marker and
keeps the backslash. `isMarkdownSafe()` is the guard: a formula whose glyphs
include `*`, `[`, `]`, `` ` ``, `~` or `_` is promoted to a block instead.

## Streaming

An unterminated formula has no closing delimiter, so it stays raw source until
the closer arrives — progressive rendering with no extra machinery. When a
target does need to be driven directly from a token stream,
`LatexStreamController` coalesces deltas and keeps incomplete prefixes from
replacing the last renderable frame:

```ts
import { completeLatexPrefix, LatexStreamController } from "@nikcli-ai/tui-math"

const stream = new LatexStreamController(renderable, {
  incompletePolicy: "apply",
  preview: completeLatexPrefix,
  updateIntervalMs: 25,
})

for await (const delta of deltas) stream.append(delta)
const result = await stream.finish()
```

## Supported LaTeX

Fractions, binomials, roots; superscripts, subscripts, Greek letters,
relations, arrows and binary operators; integrals, sums, products, limits and
named operators; stretching delimiters; `matrix`, `pmatrix`, `bmatrix`,
`Bmatrix`, `vmatrix`, `Vmatrix`, `smallmatrix`, `cases`, `array`, `aligned`,
`align`, `gathered` and their starred forms; accents; `\text`,
`\operatorname`, `\overset`, `\underset`, colors and lightweight macros.

This is a math-mode renderer, not a TeX engine: it does not compile documents,
load packages, execute arbitrary TeX, or render TikZ.
