// Content-addressed line anchors: a compact way for a model to name a line it
// has already read, instead of quoting the line back.
//
// `edit` identifies its target by repeating the text verbatim in `oldString`.
// That text is *output*, which is the expensive half — never discounted by the
// prompt cache and priced several times above input. An anchor replaces it with
// a few characters that point at the same line, and the anchor is *input*, paid
// once per read and cached from then on.
//
// The hash is the point, not the line number. A line number alone silently
// edits the wrong line whenever the file moved underneath the model, which is
// exactly the case a long agentic session produces. Pairing the number with a
// digest of the line's own bytes turns that silent corruption into a rejection.

import { createHash } from "crypto"

/**
 * Digest length, in hex characters.
 *
 * Six characters is 24 bits — a collision needs the model to cite a stale
 * anchor *and* the replacing line to hash into the same bucket, and a miss
 * costs a rejected edit rather than a wrong one. Longer digests would buy
 * little and are paid on every line of every read.
 */
const DIGEST_LENGTH = 6

/** Separator between the line number and its digest. Not `:` — that already ends the line prefix. */
const SEPARATOR = "#"

const ANCHOR_PATTERN = new RegExp(`^(\\d+)${SEPARATOR}([0-9a-f]{${DIGEST_LENGTH}})$`)

/**
 * Digest of a single line's content.
 *
 * Trailing carriage returns are stripped first: the same file read on Windows
 * and on POSIX would otherwise produce different anchors for identical content,
 * and an anchor that depends on the reader's platform is not content-addressed.
 */
export function digest(line: string): string {
  return createHash("sha256").update(line.replace(/\r$/, ""), "utf8").digest("hex").slice(0, DIGEST_LENGTH)
}

/** The anchor a reader emits for a line: its number and the digest of its content. */
export function format(lineNumber: number, line: string): string {
  return `${lineNumber}${SEPARATOR}${digest(line)}`
}

export interface Anchor {
  readonly line: number
  readonly digest: string
}

/** Parse an anchor a model cited, or undefined when it is not one. */
export function parse(value: string): Anchor | undefined {
  const match = ANCHOR_PATTERN.exec(value.trim())
  if (!match) return undefined
  const line = Number(match[1])
  // Line numbers are 1-based in every reader that emits these.
  if (!Number.isSafeInteger(line) || line < 1) return undefined
  return { line, digest: match[2]! }
}

export type Resolution =
  | { readonly ok: true; readonly line: number; readonly text: string }
  | { readonly ok: false; readonly reason: "out-of-range" | "stale"; readonly message: string }

/**
 * Resolve an anchor against the current file, refusing rather than guessing.
 *
 * The refusal is the feature. An anchor is only worth using if a file that
 * changed since the read is caught here instead of downstream, where the edit
 * would already have been applied to whatever now occupies that line.
 */
export function resolve(anchor: Anchor, lines: readonly string[]): Resolution {
  if (anchor.line > lines.length) {
    return {
      ok: false,
      reason: "out-of-range",
      message:
        `Anchor points at line ${anchor.line}, but the file has ${lines.length} ` +
        `line${lines.length === 1 ? "" : "s"}. Read the file again to get current anchors.`,
    }
  }

  const text = lines[anchor.line - 1]!
  const actual = digest(text)
  if (actual !== anchor.digest) {
    return {
      ok: false,
      reason: "stale",
      message:
        `Anchor ${anchor.line}${SEPARATOR}${anchor.digest} no longer matches line ${anchor.line}, ` +
        `which now hashes to ${actual}. The file changed since it was read — read it again ` +
        `rather than editing from the stale copy.`,
    }
  }

  return { ok: true, line: anchor.line, text }
}
