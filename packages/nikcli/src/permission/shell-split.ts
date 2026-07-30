/**
 * Quote-aware splitting of a shell line into the independent commands it will run.
 *
 * Permission checks must see each command separately: approving `git status && rm -rf build` as a
 * single opaque resource would let the dangerous half ride along with the harmless one. The bash
 * tree-sitter grammar already gives us this for Bash, but it is the wrong grammar for PowerShell
 * and is unavailable when parsing fails, so this splitter covers both cases.
 *
 * It is deliberately conservative: separators inside quotes are ignored, and anything it cannot
 * confidently split stays as one command, which fails towards *more* prompting, never less.
 */
export function splitShellStatements(input: string, options: { readonly splitPipes?: boolean } = {}): string[] {
  const splitPipes = options.splitPipes ?? true
  const parts: string[] = []
  let current = ""
  let quote: '"' | "'" | "`" | undefined

  const flush = () => {
    const trimmed = current.trim()
    if (trimmed) parts.push(trimmed)
    current = ""
  }

  for (let index = 0; index < input.length; index++) {
    const char = input[index]!

    if (quote) {
      current += char
      // A backslash escape inside double quotes cannot end the string.
      if (char === "\\" && quote === '"' && index + 1 < input.length) {
        current += input[++index]
      } else if (char === quote) {
        quote = undefined
      }
      continue
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char
      current += char
      continue
    }

    if (char === "\\" && index + 1 < input.length && input[index + 1] === "\n") {
      // Line continuation: the next line is part of this same command.
      index++
      continue
    }

    if (char === "\n" || char === ";") {
      flush()
      continue
    }

    if (char === "&" && input[index + 1] === "&") {
      index++
      flush()
      continue
    }

    if (char === "|") {
      if (input[index + 1] === "|") {
        index++
        flush()
        continue
      }
      if (splitPipes) {
        flush()
        continue
      }
    }

    current += char
  }

  // An unterminated quote means we mis-read the line; keep whatever we accumulated rather than
  // silently dropping the tail of the command.
  flush()
  return parts
}
