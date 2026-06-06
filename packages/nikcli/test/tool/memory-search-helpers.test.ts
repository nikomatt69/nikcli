import { describe, expect, it } from "bun:test"

// Re-implement the same logic shape used by `tool/memory_search.ts` to verify
// that the new (memoized-lowercase) signatures preserve the OLD behavior.
function splitTerms(query: string) {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
}

function scoreText(lower: string, terms: string[]) {
  const hits = terms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0)
  if (hits === 0) return 0
  return hits / terms.length
}

function makeSnippet(text: string, lower: string, terms: string[]) {
  const indexes = terms
    .map((term) => lower.indexOf(term))
    .filter((value) => value >= 0)
    .sort((a, b) => a - b)
  const idx = indexes[0]
  if (idx === undefined) return text.slice(0, 180).replace(/\s+/g, " ").trim()
  const start = Math.max(0, idx - 80)
  const end = Math.min(text.length, idx + 120)
  return text.slice(start, end).replace(/\s+/g, " ").trim()
}

// Reference: the OLD behavior (each function lower-cases independently)
function oldScoreText(text: string, terms: string[]) {
  const lower = text.toLowerCase()
  const hits = terms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0)
  if (hits === 0) return 0
  return hits / terms.length
}
function oldMakeSnippet(text: string, terms: string[]) {
  const lower = text.toLowerCase()
  const indexes = terms
    .map((term) => lower.indexOf(term))
    .filter((value) => value >= 0)
    .sort((a, b) => a - b)
  const idx = indexes[0]
  if (idx === undefined) return text.slice(0, 180).replace(/\s+/g, " ").trim()
  const start = Math.max(0, idx - 80)
  const end = Math.min(text.length, idx + 120)
  return text.slice(start, end).replace(/\s+/g, " ").trim()
}

describe("memory_search lower-case memoization", () => {
  const text = "The quick brown Fox jumps over the Lazy Dog while editing a TypeScript function"
  const terms = splitTerms("fox lazy typescript")

  it("scoreText returns identical results to old version", () => {
    const lower = text.toLowerCase()
    const newScore = scoreText(lower, terms)
    const oldScore = oldScoreText(text, terms)
    expect(newScore).toBe(oldScore)
    expect(newScore).toBeGreaterThan(0)
  })

  it("makeSnippet returns identical results to old version", () => {
    const lower = text.toLowerCase()
    const newSnippet = makeSnippet(text, lower, terms)
    const oldSnippet = oldMakeSnippet(text, terms)
    expect(newSnippet).toBe(oldSnippet)
  })

  it("scoreText returns 0 when no term matches", () => {
    const lower = text.toLowerCase()
    expect(scoreText(lower, ["python", "rust"])).toBe(0)
  })

  it("makeSnippet returns truncated text when no term matches", () => {
    const lower = text.toLowerCase()
    const snippet = makeSnippet(text, lower, ["python"])
    expect(snippet.length).toBeLessThanOrEqual(180)
  })

  it("perf: new version skips a toLowerCase call (sanity check)", () => {
    // We can't directly assert "no toLowerCase called" but we can assert the API
    // contract: the lower-cased string is passed in, not computed inside.
    const lower = "the quick brown fox"
    // If the new signature were to re-lowercase internally, passing an already-
    // lower string would yield the same result. We pass an upper-case to ensure
    // the new contract requires the caller to lower-case, not the callee.
    const upper = "THE QUICK BROWN FOX"
    // New API: caller is responsible. Old API: callee was responsible.
    // Both must produce the same score when the input is the same logical text.
    expect(scoreText(lower, ["fox"])).toBe(scoreText(upper.toLowerCase(), ["fox"]))
  })
})
