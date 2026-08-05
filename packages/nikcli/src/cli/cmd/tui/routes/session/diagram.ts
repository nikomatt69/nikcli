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
