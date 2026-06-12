import { sortBy, pipe } from "remeda"

export namespace Wildcard {
  // Patterns come from static config (permission rulesets, command routing)
  // and are matched on every tool call, so cache the compiled regexes. The
  // cap guards against unbounded growth if a caller ever feeds dynamic
  // patterns; config-sized pattern sets never come close to it.
  const compiled = new Map<string, RegExp>()
  const COMPILED_CACHE_MAX = 2000

  function regexFor(pattern: string): RegExp {
    const cached = compiled.get(pattern)
    if (cached) return cached
    let escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape special regex chars
      .replace(/\*/g, ".*") // * becomes .*
      .replace(/\?/g, ".") // ? becomes .

    // If pattern ends with " *" (space + wildcard), make the trailing part optional
    // This allows "ls *" to match both "ls" and "ls -la"
    if (escaped.endsWith(" .*")) {
      escaped = escaped.slice(0, -3) + "( .*)?"
    }

    const regex = new RegExp("^" + escaped + "$", "s")
    if (compiled.size >= COMPILED_CACHE_MAX) compiled.clear()
    compiled.set(pattern, regex)
    return regex
  }

  export function match(str: string, pattern: string) {
    return regexFor(pattern).test(str)
  }

  export function all(input: string, patterns: Record<string, any>) {
    const sorted = pipe(patterns, Object.entries, sortBy([([key]) => key.length, "asc"], [([key]) => key, "asc"]))
    let result = undefined
    for (const [pattern, value] of sorted) {
      if (match(input, pattern)) {
        result = value
        continue
      }
    }
    return result
  }

  export function allStructured(input: { head: string; tail: string[] }, patterns: Record<string, any>) {
    const sorted = pipe(patterns, Object.entries, sortBy([([key]) => key.length, "asc"], [([key]) => key, "asc"]))
    let result = undefined
    for (const [pattern, value] of sorted) {
      const parts = pattern.split(/\s+/)
      if (!match(input.head, parts[0])) continue
      if (parts.length === 1 || matchSequence(input.tail, parts.slice(1))) {
        result = value
        continue
      }
    }
    return result
  }

  function matchSequence(items: string[], patterns: string[], itemStart = 0, patternStart = 0): boolean {
    if (patternStart >= patterns.length) return true
    const pattern = patterns[patternStart]
    if (pattern === "*") return matchSequence(items, patterns, itemStart, patternStart + 1)
    for (let i = itemStart; i < items.length; i++) {
      if (match(items[i], pattern) && matchSequence(items, patterns, i + 1, patternStart + 1)) {
        return true
      }
    }
    return false
  }
}
