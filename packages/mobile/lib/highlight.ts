export type HighlightSegment = {
  text: string
  color: string
}

const DRACULA_COLORS = {
  keyword: "#ff79c6",
  string: "#f1fa8c",
  comment: "#6272a4",
  builtin: "#ffb86c",
  type: "#8be9fd",
  number: "#bd93f9",
  default: "#f8f8f2",
} as const

const KEYWORD_PATTERN = /\b(import|export|from|const|let|var|function|return|if|else|for|while|class|interface|type|extends|implements|async|await|try|catch|throw|new|this|static|public|private|protected|readonly|abstract|override|keyof|infer|never|unknown|any|void|null|undefined|true|false|switch|case|default|break|continue|typeof|instanceof|delete|in|of|yield|finally|do|as|is)\b/g

const PATTERNS: Array<{ regex: RegExp; color: string }> = [
  { regex: /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/, color: DRACULA_COLORS.string },
  { regex: /\/\/.*$/gm, color: DRACULA_COLORS.comment },
  { regex: /\/\*[\s\S]*?\*\//g, color: DRACULA_COLORS.comment },
  {
    regex:
      /\b(console|document|window|Math|Array|Object|String|Number|Boolean|Function|Symbol|Map|Set|Promise|setTimeout|setInterval|fetch|localStorage|sessionStorage|process|require|module|exports)\b/g,
    color: DRACULA_COLORS.builtin,
  },
  { regex: /\b[A-Z][a-zA-Z0-9]*\b/g, color: DRACULA_COLORS.type },
  { regex: /\b\d+\.?\d*\b/g, color: DRACULA_COLORS.number },
  { regex: /#[a-fA-F0-9]{3,8}\b/g, color: DRACULA_COLORS.number },
  { regex: /=>/, color: "#8be9fd" },
  { regex: /===|!==|&&|\|\||<=|>=|==|!=|\+\+|--|\+|-|\*|\/|%|\||&|\^|~/, color: "#8be9fd" },
]

function highlightLine(line: string): HighlightSegment[] {
  const matches: Array<{ start: number; end: number; color: string }> = []

  let match: RegExpExecArray | null
  KEYWORD_PATTERN.lastIndex = 0
  while ((match = KEYWORD_PATTERN.exec(line)) !== null) {
    matches.push({ start: match.index, end: match.index + match[0].length, color: DRACULA_COLORS.keyword })
  }

  for (const { regex, color } of PATTERNS) {
    regex.lastIndex = 0
    while ((match = regex.exec(line)) !== null) {
      matches.push({ start: match.index, end: match.index + match[0].length, color })
    }
  }

  if (matches.length === 0) {
    return [{ text: line, color: DRACULA_COLORS.default }]
  }

  matches.sort((a, b) => a.start - b.start)
  const filtered: typeof matches = []
  for (const m of matches) {
    if (filtered.length === 0 || m.start > filtered[filtered.length - 1].end) {
      filtered.push(m)
    }
  }

  const segments: HighlightSegment[] = []
  let lastEnd = 0
  for (const m of filtered) {
    if (m.start > lastEnd) {
      segments.push({ text: line.slice(lastEnd, m.start), color: DRACULA_COLORS.default })
    }
    segments.push({ text: line.slice(m.start, m.end), color: m.color })
    lastEnd = m.end
  }
  if (lastEnd < line.length) {
    segments.push({ text: line.slice(lastEnd), color: DRACULA_COLORS.default })
  }

  return segments
}

export function highlightCode(code: string): HighlightSegment[] {
  if (!code) return []

  const lines = code.split("\n")
  const result: HighlightSegment[] = []
  const isLastLine = lines.length - 1

  for (let i = 0; i < lines.length; i++) {
    const lineSegments = highlightLine(lines[i])
    for (let j = 0; j < lineSegments.length; j++) {
      const isLastSegmentOfLastLine = i === isLastLine && j === lineSegments.length - 1
      const text = isLastSegmentOfLastLine ? lineSegments[j].text : lineSegments[j].text + "\n"
      result.push({ text, color: lineSegments[j].color })
    }
  }

  return result
}
