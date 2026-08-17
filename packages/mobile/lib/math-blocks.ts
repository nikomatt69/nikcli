export type MathBlock = { type: "markdown"; content: string } | { type: "math"; content: string; display: boolean }

const MATH_DELIM = /(\$\$[\s\S]+?\$\$|\$[^$\n]+\$)/g

export function hasMathDelimiters(value: string) {
  return value.includes("$")
}

/** Split markdown into prose and `$…$` / `$$…$$` runs. Unterminated tails stay markdown. */
export function splitMathBlocks(source: string): MathBlock[] {
  if (!hasMathDelimiters(source)) return [{ type: "markdown", content: source }]
  const blocks: MathBlock[] = []
  let last = 0
  for (const match of source.matchAll(MATH_DELIM)) {
    const index = match.index ?? 0
    if (index > last) blocks.push({ type: "markdown", content: source.slice(last, index) })
    const raw = match[0]
    const display = raw.startsWith("$$")
    const inner = display ? raw.slice(2, -2) : raw.slice(1, -1)
    blocks.push({ type: "math", content: inner.trim(), display })
    last = index + raw.length
  }
  if (last < source.length) blocks.push({ type: "markdown", content: source.slice(last) })
  return blocks.filter((block) => block.content.length > 0)
}
