/**
 * Making a formula fit on one row.
 *
 * Inline math has to live inside a line of prose, and the layout engine
 * builds two-dimensional constructs: a fraction stacks three rows, a square
 * root puts a vinculum above its body. A sentence cannot hold either, so
 * `$\frac{1}{6}$` would otherwise be torn out of the sentence and rendered as
 * its own block.
 *
 * Written mathematics already has the answer — `1/6` and `√2` are how anyone
 * writes those in running text. This module rewrites the parsed tree into
 * that form: fractions become a division, roots lose the vinculum, and
 * anything that would be ambiguous once flattened gets parentheses.
 *
 * Only constructs with an accepted one-row spelling are rewritten. Binomial
 * coefficients keep their stacked form (`\binom{n}{k}` is not `n/k`),
 * matrices and over/under scripts stay as they are, and a formula containing
 * one of those is still promoted to its own block.
 */
import type { MathNode, SymbolRole } from "./types"

/**
 * Rewrite a parsed formula into the one-row conventions used in running text.
 * Nodes with no such convention are returned structurally unchanged.
 */
export function flattenInline(node: MathNode): MathNode {
  return flatten(node).node
}

/**
 * A flattened node plus whether it still reads as a single operand.
 *
 * Precedence is the whole difficulty here: two dimensions carry grouping for
 * free, one dimension does not. `\frac{a+b}{2}` has to become `(a + b)/2`,
 * while `\frac{\sqrt{2}}{2}` is fine as `√2/2` because a radical binds to
 * what follows it. Tracking that as the tree is rewritten is what keeps the
 * parentheses off everything that does not need them.
 */
interface Flattened {
  node: MathNode
  atomic: boolean
}

function flatten(node: MathNode): Flattened {
  switch (node.type) {
    case "fraction": {
      const numerator = flatten(node.numerator)
      const denominator = flatten(node.denominator)
      // A binomial has no bar and no one-row spelling; keep it stacked.
      if (!node.bar) {
        return { node: { ...node, numerator: numerator.node, denominator: denominator.node }, atomic: true }
      }
      return {
        node: {
          type: "row",
          // "ordinary" keeps the solidus tight: `1/6`, not `1 / 6`.
          body: [groupOperand(numerator), { type: "symbol", value: "/", role: "ordinary" }, groupTrailing(denominator)],
        },
        // A division is an expression; as someone else's operand it needs
        // brackets, which `group` adds.
        atomic: false,
      }
    }
    case "root": {
      // An index would have to sit above the radical, which is the shape we
      // are trying to avoid in the first place.
      if (node.index) return { node: { ...node, body: flatten(node.body).node }, atomic: true }
      return {
        node: {
          type: "row",
          body: [{ type: "symbol", value: "√", role: "ordinary" }, groupTrailing(flatten(node.body))],
        },
        // The radical binds to its (already bracketed) operand.
        atomic: true,
      }
    }
    case "row": {
      const body = node.body.map(flatten)
      return {
        node: { type: "row", body: body.map((child) => child.node) },
        atomic: isAtomicRow(body),
      }
    }
    case "scripts": {
      const base = flatten(node.base)
      return {
        node: {
          type: "scripts",
          base: base.node,
          ...(node.superscript ? { superscript: flatten(node.superscript).node } : {}),
          ...(node.subscript ? { subscript: flatten(node.subscript).node } : {}),
        },
        atomic: base.atomic,
      }
    }
    case "delimited":
      return { node: { ...node, body: flatten(node.body).node }, atomic: true }
    case "accent":
    case "variant":
    case "color": {
      const body = flatten(node.body)
      return { node: { ...node, body: body.node }, atomic: body.atomic }
    }
    case "overunder":
      return {
        node: {
          type: "overunder",
          base: flatten(node.base).node,
          ...(node.over ? { over: flatten(node.over).node } : {}),
          ...(node.under ? { under: flatten(node.under).node } : {}),
        },
        atomic: true,
      }
    case "matrix":
      return {
        node: { ...node, rows: node.rows.map((cells) => cells.map((cell) => flatten(cell).node)) },
        atomic: true,
      }
    default:
      return { node, atomic: true }
  }
}

/**
 * Bracket a leading operand — the numerator of a division — that would
 * otherwise lose its grouping. Ordinary precedence applies: a product needs
 * no brackets before a `/`, a sum does.
 */
function groupOperand(operand: Flattened): MathNode {
  if (operand.atomic) return operand.node
  return parenthesize(operand.node)
}

/**
 * Bracket a *trailing* operand — a denominator or a radicand — which needs a
 * stricter rule than a numerator does.
 *
 * Everything after a `/` or a `√` binds only as far as the reader decides:
 * `1/σ√2π` could be read as `(1/σ)·√2·π`, and no convention settles it. So a
 * trailing operand is bracketed unless it is a single indivisible term.
 */
function groupTrailing(operand: Flattened): MathNode {
  if (isSingleTerm(operand.node)) return operand.node
  return parenthesize(operand.node)
}

function parenthesize(node: MathNode): MathNode {
  return { type: "delimited", left: "(", body: node, right: ")" }
}

/** One symbol, one bracketed group, or one construct — nothing to misread. */
function isSingleTerm(node: MathNode): boolean {
  if (node.type !== "row") return node.type !== "fraction"
  const visible = node.body.filter((child) => child.type !== "space")
  if (visible.length === 0) return true
  if (visible.length === 1) return isSingleTerm(visible[0]!)
  // A radical produced above: `√x` is one term, because its own operand was
  // bracketed by the same rule on the way in.
  return visible.length === 2 && isRadical(visible[0]!)
}

function isRadical(node: MathNode): boolean {
  return node.type === "symbol" && node.value === "√"
}

/**
 * A row reads as one operand when nothing in it binds looser than the
 * division we are about to put it next to.
 *
 * That is ordinary precedence: `n(n+1)` is a product and survives as
 * `n(n+1)/2`, while `a+b` has a top-level sum and must become `(a + b)/2`.
 * Depth tracking keeps the `+` in `n(n+1)` from counting — it belongs to the
 * bracketed group, not to the row. A child that is itself a flattened
 * division also disqualifies the row, since `2·a/b` over `3` would otherwise
 * collapse into the unreadable `2a/b/3`.
 */
function isAtomicRow(body: Flattened[]): boolean {
  const visible = body.filter((child) => child.node.type !== "space")
  if (visible.length <= 1) return visible.every((child) => child.atomic)

  let depth = 0
  for (let index = 0; index < visible.length; index++) {
    const child = visible[index]!
    if (!child.atomic) return false
    const role = roleOf(child.node)
    if (role === "opening") depth++
    else if (role === "closing") depth--
    // A binary symbol in first position is a sign, not an operation: the `-`
    // of `-b` binds tighter than the division it sits next to.
    else if (depth === 0 && index > 0 && (role === "binary" || role === "relation")) return false
  }
  return true
}

function roleOf(node: MathNode): SymbolRole | undefined {
  return node.type === "symbol" ? node.role : undefined
}
