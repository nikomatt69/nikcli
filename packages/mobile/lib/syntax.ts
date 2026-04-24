// Dracula-palette syntax highlighting — shared by MessageBubble and CodeEditor

export const DRACULA = {
  foreground: "#f8f8f2",
  comment: "#6272a4",
  keyword: "#ff79c6",
  string: "#50fa7b",
  builtin: "#ffb86c",
  number: "#bd93f9",
  operator: "#8be9fd",
  muted: "#abb2bf",
} as const

const PATTERNS: { regex: RegExp; color: string }[] = [
  {
    regex:
      /\b(import|export|from|const|let|var|function|return|if|else|for|while|class|interface|type|extends|implements|async|await|try|catch|throw|new|this|static|public|private|protected|readonly|abstract|override|keyof|infer|never|unknown|any|void|null|undefined|true|false|switch|case|default|break|continue|typeof|instanceof|delete|in|of|yield|finally|do|as|is)\b/g,
    color: DRACULA.keyword,
  },
  { regex: /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g, color: DRACULA.string },
  { regex: /\/\/.*$/gm, color: DRACULA.comment },
  { regex: /\/\*[\s\S]*?\*\//g, color: DRACULA.comment },
  {
    regex:
      /\b(console|document|window|Math|Array|Object|String|Number|Boolean|Function|Symbol|Map|Set|Promise|setTimeout|setInterval|fetch|localStorage|sessionStorage|process|require|module|exports)\b/g,
    color: DRACULA.builtin,
  },
  { regex: /\b[A-Z][a-zA-Z0-9]*\b/g, color: DRACULA.builtin },
  { regex: /\b\d+\.?\d*\b/g, color: DRACULA.number },
  { regex: /#[a-fA-F0-9]{3,8}\b/g, color: DRACULA.number },
  { regex: /=>|===|!==|&&|\|\||<=|>=|==|!=|\+\+|--|\+|-|\*|\/|%|\||&|\^|~|\?|:/g, color: DRACULA.operator },
]

export type Segment = { text: string; color: string }

export function highlightLine(line: string): Segment[] {
  const matches: { start: number; end: number; text: string; color: string }[] = []

  for (const { regex, color } of PATTERNS) {
    regex.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = regex.exec(line)) !== null) {
      matches.push({ start: m.index, end: m.index + m[0].length, text: m[0], color })
    }
  }

  matches.sort((a, b) => a.start - b.start)

  const filtered: typeof matches = []
  for (const m of matches) {
    if (filtered.length === 0 || m.start >= filtered[filtered.length - 1].end) {
      filtered.push(m)
    }
  }

  if (filtered.length === 0) return [{ text: line, color: DRACULA.foreground }]

  const segments: Segment[] = []
  let lastEnd = 0
  for (const m of filtered) {
    if (m.start > lastEnd) segments.push({ text: line.slice(lastEnd, m.start), color: DRACULA.foreground })
    segments.push({ text: m.text, color: m.color })
    lastEnd = m.end
  }
  if (lastEnd < line.length) segments.push({ text: line.slice(lastEnd), color: DRACULA.muted })
  return segments
}

export function highlightCode(code: string): Segment[] {
  const lines = code.split("\n")
  const result: Segment[] = []

  lines.forEach((line, lineIndex) => {
    const segs = highlightLine(line)
    segs.forEach((seg, i) => {
      result.push({
        text: i === segs.length - 1 && lineIndex < lines.length - 1 ? seg.text + "\n" : seg.text,
        color: seg.color,
      })
    })
  })

  return result.length > 0 ? result : [{ text: code, color: DRACULA.foreground }]
}

const EXT_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  cpp: "cpp",
  cs: "csharp",
  php: "php",
  html: "html",
  css: "css",
  scss: "scss",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  md: "markdown",
  mdx: "mdx",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  sql: "sql",
  toml: "toml",
  xml: "xml",
  graphql: "graphql",
  gql: "graphql",
}

export function detectLanguage(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? ""
  return EXT_MAP[ext] ?? "code"
}
