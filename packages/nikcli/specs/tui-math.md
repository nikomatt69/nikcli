# LaTeX math in the TUI

Assistant answers about anything quantitative arrive full of `$…$` and
`$$…$$`. Before this, the markdown renderer painted those as literal dollar
signs and backslashes — the reader got the LaTeX source, not the formula.

nikcli now renders them, on by default, in every terminal.

## Shape

| Piece                                            | Where                                                         |
| ------------------------------------------------ | ------------------------------------------------------------- |
| Renderer (parser, layout, renderable, streaming) | `packages/tui-math/src`                                       |
| Math-in-prose splitting                          | `packages/tui-math/src/{detect,markdown,inline}.ts`           |
| Solid intrinsic `<nikcli_latex>`                 | `packages/tui-math/src/solid.ts`                              |
| TUI component                                    | `packages/nikcli/src/cli/cmd/tui/component/math-markdown.tsx` |
| Call sites                                       | `TextPart` and `ReasoningPart` in `routes/session/index.tsx`  |
| Config                                           | `tui.math` (default `true`)                                   |

`packages/tui-math` is a port of
[opentui-math](https://github.com/neriousy/opentui-math) (MIT), vendored as
source rather than added as a dependency so the feature ships with the binary
and can be changed here. Upstream's second backend — MathJax rasterized into
Kitty graphics — is **not** ported: it needs `mathjax` plus a rasterizer, and
it only works on graphics-capable terminals. The Unicode cell renderer is
what makes the feature universal, so it is the whole of the port.

## How a message becomes blocks

`buildMathBlocks()` splits a message into markdown runs and math runs. The
TUI component renders the first with `<markdown>` (unchanged, same props as
before) and the second with `<nikcli_latex>`.

The common case is free: a message with no math delimiter costs one scan and
produces a single markdown block holding the original content, so the render
tree is exactly what it was before.

Display math becomes its own block. Inline math is substituted into the
sentence as text when it lays out on one row — `$x^2$` is `x²`, `$\alpha_i$`
is `αᵢ` — because a taller renderable cannot sit inside a line box.

### Inline flattening

A fraction stacks three rows and a root puts a vinculum above its body, so
`$\frac{1}{6}$` would be torn out of the sentence. `src/inline.ts` rewrites
the parsed tree into the spelling running text already uses — `1/6`, `√2` —
and adds brackets wherever one dimension loses the grouping two dimensions
gave for free:

| Source                        | Inline       |
| ----------------------------- | ------------ |
| `\frac{n(n+1)}{2}`            | `n(n + 1)/2` |
| `\frac{a+b}{2}`               | `(a + b)/2`  |
| `\frac{1}{\sigma\sqrt{2\pi}}` | `1/(σ√(2π))` |
| `\frac{-b}{2a}`               | `-b/(2a)`    |
| `\sqrt{2\pi}`                 | `√(2π)`      |

Numerators follow ordinary precedence, so a product needs no brackets before
a `/`. Denominators and radicands are stricter — everything after a `/` or a
`√` binds only as far as the reader decides, and `1/σ√2π` has no settled
reading — so they are bracketed unless they are a single term.

Constructs with no one-row spelling (matrices, binomials, accents,
over/under) are promoted to their own block instead.

## Two constraints worth knowing

**`$` is a prose character.** `$5 to $10`, `set $PATH and $HOME` and shell
snippets must stay text. `src/detect.ts` masks fenced blocks and inline code
first, then applies the TeX-ish delimiter rules (no space just inside the
delimiters, no digit right after the closer, no blank line inside, no purely
numeric body). Ambiguous `$…$` spans additionally have to parse in _strict_
mode; unambiguous delimiters (`$$`, `\[`, `\(`, `\begin{…}`) get the tolerant
parser, because an author who writes `\[` meant math.

**Substituted text cannot be escaped.** It re-enters the markdown parser, and
that parser conceals syntax markers by deleting the marker while keeping the
backslash: `\[x\]` paints as `\x\` and `[x]` paints as `x`. There is no
spelling that survives. So `isMarkdownSafe()` gates substitution instead — a
formula containing `*`, `[`, `]`, `` ` ``, `~` or `_` is promoted to a block,
where cells are painted directly and no parser is involved. Most math is
inert: the renderer emits `∗` for `\ast` and `∼` for `\sim`, and superscripts
and Greek letters have no markdown meaning. Brackets are the common exception.

`test/tui/math-renderable.test.tsx` pins both halves of this: that the
markdown renderer really does eat those characters, and that every formula in
a realistic corpus paints back byte-identical.

## Streaming

Nothing special is needed. An unterminated formula has no closing delimiter,
so it stays inside the markdown run as raw source and becomes a formula the
moment the closer arrives. Only the trailing markdown run is told it is
streaming, since it is the only one that can still grow.

## Why not `renderNode`

`MarkdownRenderable` accepts a `renderNode` hook, which looks like the
natural integration point. It is not usable here: when a block's token
changes and the existing renderable is neither a `CodeRenderable` nor a
`TextTableRenderable`, `updateBlockRenderable` destroys it and replaces it
with a default markdown renderable. A custom renderable therefore does not
survive the first content edit — which, while streaming, is immediate.
Providing `renderNode` also disables the merging of consecutive markdown
tokens into one block. Composing the blocks ourselves avoids both.

## Configuration

`tui.math: false` restores the old behavior (raw `$…$` in the message). The
option is in `Config.TUI` and `TuiOptions`; the SDK type is regenerated from
the OpenAPI spec, not hand-edited.
