export { Patch } from "./index"

export function normalizeUnicode(str: string): string {
  return (
    str
      .normalize("NFC")
      .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
      .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
      // Hyphens/dashes + Unicode minus (U+2212) → ASCII hyphen-minus
      .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
      .replace(/\u2026/g, "...")
      .replace(/\u00A0/g, " ")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
  )
}

export function rstrip(str: string): string {
  return str.replace(/\s+$/, "")
}

export function strip(str: string): string {
  return str.trim()
}

export type MatchStrategy = "exact" | "rstrip" | "strip" | "unicode" | "fuzzy"

export interface MatchResult {
  matched: boolean
  strategy: MatchStrategy | null
  original: string
  matchedValue: string
}

export function matchLine(original: string, target: string, strategy: MatchStrategy = "exact"): boolean {
  switch (strategy) {
    case "exact":
      return original === target
    case "rstrip":
      return rstrip(original) === rstrip(target)
    case "strip":
      return strip(original) === strip(target)
    case "unicode":
      return normalizeUnicode(original) === normalizeUnicode(target)
    case "fuzzy":
      return (
        strip(normalizeUnicode(original)) === strip(normalizeUnicode(target)) ||
        rstrip(normalizeUnicode(original)) === rstrip(normalizeUnicode(target))
      )
    default:
      return false
  }
}

export function findBestMatch(
  originalLines: string[],
  targetLines: string[],
  startIndex: number,
): { index: number; strategy: MatchStrategy } | null {
  const strategies: MatchStrategy[] = ["exact", "rstrip", "strip", "unicode", "fuzzy"]

  for (const strategy of strategies) {
    for (let i = startIndex; i < originalLines.length; i++) {
      if (matchLine(originalLines[i], targetLines[0], strategy)) {
        let allMatch = true
        for (let j = 1; j < targetLines.length && i + j < originalLines.length; j++) {
          if (!matchLine(originalLines[i + j], targetLines[j], strategy)) {
            allMatch = false
            break
          }
        }
        if (allMatch) {
          return { index: i, strategy }
        }
      }
    }
  }

  return null
}

export interface FuzzyMatchOptions {
  context?: number
  maxAttempts?: number
}

export function fuzzyMatch(
  originalLines: string[],
  oldLines: string[],
  newLines: string[],
  _options: FuzzyMatchOptions = {},
): {
  success: boolean
  applied: string[]
  strategy: MatchStrategy | null
  oldStart: number
  oldEnd: number
  newStart: number
  newEnd: number
} {
  let bestMatch: {
    index: number
    strategy: MatchStrategy
    matchLength: number
  } | null = null

  for (const strategy of ["exact", "rstrip", "strip", "unicode", "fuzzy"] as MatchStrategy[]) {
    if (bestMatch) break

    for (let i = 0; i < originalLines.length && (bestMatch === null || bestMatch.strategy !== strategy); i++) {
      let matchLength = 0

      for (let j = 0; j < oldLines.length && i + j < originalLines.length; j++) {
        if (matchLine(originalLines[i + j], oldLines[j], strategy)) {
          matchLength++
        } else {
          break
        }
      }

      if (matchLength === oldLines.length && (!bestMatch || matchLength > bestMatch.matchLength)) {
        bestMatch = { index: i, strategy, matchLength }
        if (strategy === "exact") break
      }
    }
  }

  if (!bestMatch) {
    return {
      success: false,
      applied: originalLines,
      strategy: null,
      oldStart: -1,
      oldEnd: -1,
      newStart: -1,
      newEnd: -1,
    }
  }

  const { index: startIndex, strategy } = bestMatch

  const beforeContext = originalLines.slice(0, startIndex)
  const afterContext = originalLines.slice(startIndex + oldLines.length)

  const result = [...beforeContext, ...newLines, ...afterContext]

  return {
    success: true,
    applied: result,
    strategy,
    oldStart: startIndex,
    oldEnd: startIndex + oldLines.length - 1,
    newStart: startIndex,
    newEnd: startIndex + newLines.length - 1,
  }
}
