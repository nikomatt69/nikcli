/**
 * Finding math inside prose.
 *
 * The renderer needs a formula; a model gives us a markdown message with a
 * formula somewhere in it. This module is the bridge: it splits markdown into
 * plain-text runs and math runs so the caller can send the first to its
 * markdown renderer and the second to {@link renderLatex}.
 *
 * Two things make that harder than a regex:
 *
 * 1. `$` is a common prose character. `$5 to $10`, `set $PATH and $HOME`, and
 *    `cost: $12` must stay text. The delimiter rules below are the TeX-ish
 *    ones Pandoc uses (no space just inside the delimiters, no digit right
 *    after the closer), plus a rejection of purely numeric bodies.
 * 2. Code must be left alone. A shell block full of `$VAR` is masked out
 *    before any delimiter scanning happens.
 *
 * Even so, heuristics on `$…$` will occasionally fire on something that is
 * not math, so single-`$` spans additionally have to parse in *strict* mode
 * to survive. An unparseable span is not an error — it is simply text, and it
 * is emitted unchanged. That asymmetry is deliberate: unambiguous delimiters
 * (`$$`, `\[`, `\(`, `\begin{…}`) get the tolerant parser, because when an
 * author writes `\[` they meant math and a best-effort render beats raw
 * source.
 */
import { parseLatex } from "./parser"
import type { ParseOptions } from "./types"

/** A run of the input: either untouched prose or a formula to render. */
export type MathSegment =
  | { type: "text"; value: string }
  | {
      type: "math"
      /** The LaTeX body, delimiters stripped. */
      value: string
      /** Exactly as written, delimiters included — for fallback rendering. */
      raw: string
      /** Display math occupies its own block; inline math sits in a line. */
      display: boolean
    }

export interface SplitMathOptions {
  /** Parser options used to decide whether a candidate is really math. */
  parseOptions?: ParseOptions
  /**
   * Longest accepted formula body. Anything longer stays text — a runaway
   * `$` in a long message must not turn half the reply into a formula.
   */
  maxLength?: number
  /** Recognize `$…$` and `\(…\)`. Defaults to `true`. */
  inline?: boolean
  /** Recognize `$$…$$`, `\[…\]` and math environments. Defaults to `true`. */
  display?: boolean
}

const DEFAULT_MAX_LENGTH = 4_000

/** Environments a model writes bare, without surrounding math delimiters. */
const DISPLAY_ENVIRONMENTS = new Set([
  "align",
  "aligned",
  "alignat",
  "array",
  "Bmatrix",
  "bmatrix",
  "cases",
  "displaymath",
  "equation",
  "gather",
  "gathered",
  "matrix",
  "pmatrix",
  "smallmatrix",
  "split",
  "vmatrix",
  "Vmatrix",
])

/**
 * Environments the layout engine does not model. Their body is still math, so
 * the wrapper is dropped and the contents are rendered on their own.
 */
const UNWRAPPED_ENVIRONMENTS = new Set(["displaymath", "equation", "split", "alignat"])

/**
 * Cheap pre-check so callers can skip the scan entirely. Every message in a
 * session passes through here, and the overwhelming majority contain no math
 * at all.
 */
export function hasMathDelimiter(input: string): boolean {
  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (char === "$") return true
    if (char !== "\\") continue
    const next = input[i + 1]
    if (next === "(" || next === "[") return true
    if (input.startsWith("\\begin{", i)) return true
  }
  return false
}

/**
 * Split markdown into prose and math runs. Concatenating the segments'
 * original text reproduces the input exactly, so a caller that ignores the
 * math segments loses nothing.
 */
export function splitMathSegments(input: string, options: SplitMathOptions = {}): MathSegment[] {
  if (!input || !hasMathDelimiter(input)) return input ? [{ type: "text", value: input }] : []

  const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH
  const allowInline = options.inline ?? true
  const allowDisplay = options.display ?? true
  const parseOptions = options.parseOptions ?? {}
  const masked = maskCode(input)

  const segments: MathSegment[] = []
  let textStart = 0
  let index = 0

  const pushText = (end: number) => {
    if (end > textStart) segments.push({ type: "text", value: input.slice(textStart, end) })
  }

  while (index < input.length) {
    if (masked[index]) {
      index++
      continue
    }
    const match = matchDelimiter(input, index, masked, allowInline, allowDisplay)
    if (!match) {
      index++
      continue
    }
    if (match.kind === "skip") {
      index += match.length
      continue
    }
    const body = match.body.trim()
    if (!body || body.length > maxLength || !isRenderable(body, match.strict, parseOptions)) {
      // Not math after all. Skip past the opener only, so a later delimiter in
      // the same run still gets its chance.
      index += match.openerLength
      continue
    }
    pushText(index)
    segments.push({
      type: "math",
      value: body,
      raw: input.slice(index, match.end),
      display: match.display,
    })
    index = match.end
    textStart = index
  }

  pushText(input.length)
  return segments
}

type DelimiterMatch =
  /** A recognized opener whose delimiter class the caller switched off. */
  | { kind: "skip"; length: number }
  | {
      kind: "math"
      body: string
      end: number
      display: boolean
      /** Ambiguous delimiters must parse strictly to count as math. */
      strict: boolean
      openerLength: number
    }

function matchDelimiter(
  input: string,
  index: number,
  masked: Uint8Array,
  allowInline: boolean,
  allowDisplay: boolean,
): DelimiterMatch | undefined {
  const char = input[index]

  if (char === "$") {
    if (input.startsWith("$$", index)) {
      // Never reinterpret a disabled `$$` as two inline delimiters.
      if (!allowDisplay) return { kind: "skip", length: 2 }
      const end = findClosing(input, masked, "$$", index + 2)
      if (end < 0) return { kind: "skip", length: 2 }
      return {
        kind: "math",
        body: input.slice(index + 2, end),
        end: end + 2,
        display: true,
        strict: false,
        openerLength: 2,
      }
    }
    if (!allowInline) return undefined
    return matchDollarInline(input, masked, index)
  }

  if (char !== "\\") return undefined

  if (input.startsWith("\\[", index)) {
    if (!allowDisplay) return undefined
    const end = findClosing(input, masked, "\\]", index + 2)
    if (end < 0) return undefined
    return {
      kind: "math",
      body: input.slice(index + 2, end),
      end: end + 2,
      display: true,
      strict: false,
      openerLength: 2,
    }
  }

  if (input.startsWith("\\(", index)) {
    if (!allowInline) return undefined
    const end = findClosing(input, masked, "\\)", index + 2)
    if (end < 0) return undefined
    return {
      kind: "math",
      body: input.slice(index + 2, end),
      end: end + 2,
      display: false,
      strict: false,
      openerLength: 2,
    }
  }

  if (input.startsWith("\\begin{", index)) {
    if (!allowDisplay) return undefined
    const nameEnd = input.indexOf("}", index + 7)
    if (nameEnd < 0) return undefined
    const rawName = input.slice(index + 7, nameEnd)
    const name = rawName.endsWith("*") ? rawName.slice(0, -1) : rawName
    if (!DISPLAY_ENVIRONMENTS.has(name)) return undefined
    const closer = `\\end{${rawName}}`
    const end = findClosing(input, masked, closer, nameEnd + 1)
    if (end < 0) return undefined
    const body = UNWRAPPED_ENVIRONMENTS.has(name)
      ? input.slice(nameEnd + 1, end)
      : input.slice(index, end + closer.length)
    return {
      kind: "math",
      body,
      end: end + closer.length,
      display: true,
      strict: false,
      openerLength: nameEnd + 1 - index,
    }
  }

  return undefined
}

/**
 * `$…$`, the ambiguous case. Requires a non-space character just inside each
 * delimiter, forbids a digit right after the closer (`$5 to $10`), forbids
 * blank lines inside the body, and rejects bodies that are only a number.
 */
function matchDollarInline(input: string, masked: Uint8Array, index: number): DelimiterMatch | undefined {
  const first = input[index + 1]
  if (first === undefined || isSpace(first)) return undefined

  for (let i = index + 1; i < input.length; i++) {
    if (masked[i]) return undefined
    const char = input[i]
    if (char === "\\") {
      i++
      continue
    }
    if (char === "\n" && input[i + 1] === "\n") return undefined
    if (char !== "$") continue

    const previous = input[i - 1]
    if (previous === undefined || isSpace(previous)) return undefined
    const next = input[i + 1]
    if (next !== undefined && next >= "0" && next <= "9") return undefined

    const body = input.slice(index + 1, i)
    if (/^[\d\s.,]+$/.test(body)) return undefined
    return { kind: "math", body, end: i + 1, display: false, strict: true, openerLength: 1 }
  }
  return undefined
}

function findClosing(input: string, masked: Uint8Array, closer: string, from: number): number {
  let at = input.indexOf(closer, from)
  while (at >= 0) {
    if (!masked[at]) return at
    at = input.indexOf(closer, at + 1)
  }
  return -1
}

function isSpace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r"
}

function isRenderable(body: string, strict: boolean, parseOptions: ParseOptions): boolean {
  try {
    parseLatex(body, { ...parseOptions, strict })
    return true
  } catch {
    return false
  }
}

/**
 * Mark every byte that belongs to a fenced code block or an inline code span,
 * so delimiter scanning never looks inside code. Indented code blocks are not
 * masked: telling a four-space indent apart from a wrapped list item needs a
 * real block parser, and the delimiter rules already survive the difference.
 */
function maskCode(input: string): Uint8Array {
  const masked = new Uint8Array(input.length)
  let fence: string | undefined
  let lineStart = 0

  while (lineStart <= input.length) {
    const newline = input.indexOf("\n", lineStart)
    const lineEnd = newline < 0 ? input.length : newline
    const line = input.slice(lineStart, lineEnd)
    const marker = fenceMarker(line)

    if (fence) {
      masked.fill(1, lineStart, Math.min(lineEnd + 1, input.length))
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = undefined
    } else if (marker) {
      fence = marker
      masked.fill(1, lineStart, Math.min(lineEnd + 1, input.length))
    } else {
      maskInlineCode(input, lineStart, lineEnd, masked)
    }

    if (newline < 0) break
    lineStart = newline + 1
  }

  return masked
}

/** The ``` or ~~~ run opening or closing a fence, if this line is one. */
function fenceMarker(line: string): string | undefined {
  let index = 0
  while (index < 3 && line[index] === " ") index++
  const char = line[index]
  if (char !== "`" && char !== "~") return undefined
  let length = 0
  while (line[index + length] === char) length++
  if (length < 3) return undefined
  return char.repeat(length)
}

function maskInlineCode(input: string, start: number, end: number, masked: Uint8Array): void {
  let index = start
  while (index < end) {
    if (input[index] !== "`") {
      index++
      continue
    }
    let openLength = 0
    while (input[index + openLength] === "`") openLength++
    const ticks = "`".repeat(openLength)
    let search = index + openLength
    let closed = -1
    while (search < end) {
      const at = input.indexOf(ticks, search)
      if (at < 0 || at >= end) break
      if (input[at + openLength] === "`") {
        search = at + openLength
        while (input[search] === "`") search++
        continue
      }
      closed = at
      break
    }
    if (closed < 0) {
      index += openLength
      continue
    }
    masked.fill(1, index, closed + openLength)
    index = closed + openLength
  }
}
