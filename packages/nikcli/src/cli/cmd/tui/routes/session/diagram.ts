/**
 * Fencing for ASCII diagrams in assistant prose.
 *
 * When the assistant draws a box diagram inside a paragraph, the markdown
 * renderer paints it in plain `theme.text` and the alignment reads as noise.
 * Wrapping runs of diagram-looking lines in a fenced code block hands them to
 * opentui's `CodeRenderable`, which restores the themed `markdownCodeBlock`
 * colouring the old `<code filetype="markdown">` path produced — without
 * flattening the real markdown (headings, lists, tables) around it.
 *
 * **Only ever called on settled text.** It walks the whole message, so on a
 * live part it costs O(n) per token and O(n²) over the message; and it cannot
 * be right yet anyway, because a half-written line holds one box character and
 * reads as prose, then reads as a diagram a character later, rebuilding the
 * block each time it changes its mind. `TextPart` and `ReasoningPart` call it
 * once the part completes.
 *
 * Deliberately dependency-free: no Solid, no renderer, no store — same rule as
 * `rows.ts` and `view.ts`, and for the same reason.
 */

const DIAGRAM_CHARS = new Set(
  "─━│┃┌┍┎┏┐┑┒┓└┕┖┗┘┙┚┛├┝┞┟┠┡┢┣┤┥┦┧┨┩┪┫┬┭┮┯┰┱┲┳┴┵┶┷┸┹┺┻┼┽┾┿╀╁╂╃╄╅╆╇╈╉╊╋" +
    "═║╒╓╔╕╖╗╘╙╚╛╜╝╞╟╠╡╢╣╤╥╦╧╨╩╪╫╬╭╮╯╰╱╲╳" +
    "▲▼◀▶△▽◁▷◆◇■□●○◉◍◎★☆" +
    "←→↑↓↔↕⇐⇒⇑⇓⇔⇕",
)

function looksLikeDiagramLine(line: string): boolean {
  let count = 0
  for (const ch of line) {
    if (DIAGRAM_CHARS.has(ch)) {
      count++
      if (count >= 2) return true
    }
  }
  return false
}

export function wrapDiagramsInFences(md: string): string {
  if (md.length === 0) return md
  // Fast path: no diagram chars at all
  let hasAny = false
  for (let i = 0; i < md.length; i++) {
    if (DIAGRAM_CHARS.has(md[i])) {
      hasAny = true
      break
    }
  }
  if (!hasAny) return md

  const lines = md.split("\n")
  const out: string[] = []
  let inFence = false
  let blockStart = -1

  const flush = (endIdx: number) => {
    if (blockStart < 0) return
    out.push("```")
    for (let j = blockStart; j <= endIdx; j++) out.push(lines[j])
    out.push("```")
    blockStart = -1
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (trimmed.startsWith("```")) {
      flush(i - 1)
      inFence = !inFence
      out.push(line)
      continue
    }
    if (inFence) {
      out.push(line)
      continue
    }
    if (looksLikeDiagramLine(line)) {
      if (blockStart < 0) blockStart = i
      continue
    }
    flush(i - 1)
    out.push(line)
  }
  flush(lines.length - 1)
  return out.join("\n")
}

/**
 * Markdown the session renderer should feed OpenTUI.
 *
 * Trailing whitespace is significant while the part is still arriving: a
 * heading, list, or fence is not committed until its terminating newline
 * lands. Trimming that newline on every token makes the last titles at the
 * bottom of a live response oscillate between paragraph and heading — the
 * flicker in the lower-left of the transcript. Leading trim is still fine;
 * it does not change block type. Once the part is sealed, a full trim
 * matches the settled path.
 */
export function liveMarkdown(text: string, streaming: boolean): string {
  if (streaming) return text.replace(/^\s+/, "")
  return text.trim()
}

export interface LiveSplit {
  /** Blocks that are already finished. Safe to render as settled markdown. */
  settled: string
  /** The block still being written. */
  live: string
}

const LIST_ITEM = /^ {0,3}(?:[-*+][ \t]|\d{1,9}[.)][ \t])/
const BLOCKQUOTE = /^ {0,3}>/
const INDENTED = /^(?: {4}|\t)/
const FENCE = /^ {0,3}(?:```|~~~)/

/**
 * A blank line only ends a block if the block before it can end there. Inside a
 * list or a blockquote it is a separator, not a terminator, and splitting on it
 * would hand the two halves to two parsers that each see a different document.
 */
function closesABlock(lastNonBlank: string): boolean {
  return !LIST_ITEM.test(lastNonBlank) && !BLOCKQUOTE.test(lastNonBlank) && !INDENTED.test(lastNonBlank)
}

/**
 * Split live text at the last finished block.
 *
 * The session renders the two halves as two `<markdown>` runs: the settled one
 * with `streaming` off, the live one with it on. That is the whole point —
 * `streaming` keeps OpenTUI's last two tokens unstable, so it re-lexes them on
 * every delta and hands each rebuilt block to tree-sitter again. A heading that
 * falls back inside that window loses its highlight for as long as the async
 * highlight is in flight, and comes back as raw `### …` in the default colour:
 * the titles flickering at the bottom of a live response. Rendered as settled
 * markdown, a block that is already on screen is never re-parsed, so it cannot
 * flicker — only the block still being written keeps moving.
 *
 * The boundary is monotonic: a candidate depends only on the text before it, so
 * candidates accumulate and the split point only ever moves forward. Blocks
 * already handed to the settled run stay there.
 */
export function splitLiveMarkdown(md: string): LiveSplit {
  if (md.length === 0) return { settled: "", live: "" }

  const lines = md.split("\n")
  let offset = 0
  let inFence = false
  let lastNonBlank = ""
  let best = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const next = offset + line.length + 1

    if (FENCE.test(line)) {
      inFence = !inFence
      lastNonBlank = line
      offset = next
      continue
    }

    // The last line has no terminating newline yet, so it cannot close a block.
    if (!inFence && line.trim() === "" && lastNonBlank !== "" && i < lines.length - 1 && closesABlock(lastNonBlank)) {
      best = next
    }

    if (line.trim() !== "") lastNonBlank = line
    offset = next
  }

  return { settled: md.slice(0, best), live: md.slice(best) }
}
