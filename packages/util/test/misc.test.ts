import { describe, expect, test } from "bun:test"
import { findLast } from "../src/array"
import { formatDuration } from "../src/format"
import { Identifier } from "../src/identifier"
import { isRecord } from "../src/record"
import { retry } from "../src/retry"
import { Token } from "../src/token"

describe("findLast", () => {
  test("returns the last match, not the first", () => {
    expect(findLast([1, 2, 3, 4], (n) => n % 2 === 0)).toBe(4)
  })

  test("returns undefined when nothing matches", () => {
    expect(findLast([1, 3], (n) => n % 2 === 0)).toBeUndefined()
    expect(findLast([], () => true)).toBeUndefined()
  })

  test("passes index and the source array to the predicate", () => {
    const seen: number[] = []
    findLast(["a", "b", "c"], (_item, index, items) => {
      expect(items).toHaveLength(3)
      seen.push(index)
      return false
    })
    expect(seen).toEqual([2, 1, 0])
  })
})

describe("isRecord", () => {
  test("accepts plain objects", () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord({ a: 1 })).toBe(true)
  })

  test("rejects arrays, null, and primitives", () => {
    expect(isRecord([])).toBe(false)
    expect(isRecord(null)).toBe(false)
    expect(isRecord(undefined)).toBe(false)
    expect(isRecord("s")).toBe(false)
    expect(isRecord(1)).toBe(false)
  })
})

describe("Token.estimate", () => {
  test("counts four characters per token, rounded", () => {
    expect(Token.estimate("")).toBe(0)
    expect(Token.estimate("abcd")).toBe(1)
    expect(Token.estimate("abcdefgh")).toBe(2)
    expect(Token.estimate("ab")).toBe(1)
    expect(Token.estimate("a")).toBe(0)
  })

  test("never returns a negative count", () => {
    expect(Token.estimate(undefined as unknown as string)).toBe(0)
  })
})

describe("formatDuration", () => {
  test("returns empty string for zero and negative input", () => {
    expect(formatDuration(0)).toBe("")
    expect(formatDuration(-5)).toBe("")
  })

  test("formats seconds", () => {
    expect(formatDuration(1)).toBe("1s")
    expect(formatDuration(59)).toBe("59s")
  })

  test("formats minutes, dropping a zero remainder", () => {
    expect(formatDuration(60)).toBe("1m")
    expect(formatDuration(90)).toBe("1m 30s")
    expect(formatDuration(120)).toBe("2m")
  })

  test("formats hours, dropping a zero remainder", () => {
    expect(formatDuration(3600)).toBe("1h")
    expect(formatDuration(3661)).toBe("1h 1m")
  })

  test("formats days and weeks approximately", () => {
    expect(formatDuration(86400)).toBe("~1 day")
    expect(formatDuration(172800)).toBe("~2 days")
    expect(formatDuration(604800)).toBe("~1 week")
    expect(formatDuration(1209600)).toBe("~2 weeks")
  })
})

describe("Identifier", () => {
  test("produces ids of a fixed length", () => {
    expect(Identifier.ascending()).toHaveLength(26)
    expect(Identifier.descending()).toHaveLength(26)
  })

  test("ascending ids sort in creation order", () => {
    const ids = Array.from({ length: 50 }, () => Identifier.ascending())
    expect([...ids].sort()).toEqual(ids)
  })

  test("descending ids sort in reverse creation order", () => {
    const ids = Array.from({ length: 50 }, () => Identifier.descending())
    expect([...ids].sort().reverse()).toEqual(ids)
  })

  test("stays monotonic within a single timestamp", () => {
    // Pinning the timestamp forces the intra-millisecond counter path.
    const ids = Array.from({ length: 20 }, () => Identifier.create(false, 1_700_000_000_000))
    expect([...ids].sort()).toEqual(ids)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test("encodes the timestamp in the leading hex prefix", () => {
    const earlier = Identifier.create(false, 1_700_000_000_000).slice(0, 12)
    const later = Identifier.create(false, 1_700_000_001_000).slice(0, 12)
    expect(earlier < later).toBe(true)
    expect(earlier).toMatch(/^[0-9a-f]{12}$/)
  })
})

describe("retry", () => {
  test("returns the first successful result without retrying", async () => {
    let calls = 0
    const result = await retry(async () => {
      calls += 1
      return "ok"
    })
    expect(result).toBe("ok")
    expect(calls).toBe(1)
  })

  test("retries transient errors and eventually succeeds", async () => {
    let calls = 0
    const result = await retry(
      async () => {
        calls += 1
        if (calls < 3) throw new Error("socket hang up")
        return "ok"
      },
      { delay: 0 },
    )
    expect(result).toBe("ok")
    expect(calls).toBe(3)
  })

  test("does not retry a non-transient error", async () => {
    let calls = 0
    await expect(
      retry(
        async () => {
          calls += 1
          throw new Error("bad request")
        },
        { delay: 0 },
      ),
    ).rejects.toThrow("bad request")
    expect(calls).toBe(1)
  })

  test("gives up after the attempt budget and rethrows the last error", async () => {
    let calls = 0
    await expect(
      retry(
        async () => {
          calls += 1
          throw new Error("ECONNRESET")
        },
        { attempts: 4, delay: 0 },
      ),
    ).rejects.toThrow("ECONNRESET")
    expect(calls).toBe(4)
  })

  test("honours a custom retryIf predicate", async () => {
    let calls = 0
    await expect(
      retry(
        async () => {
          calls += 1
          throw new Error("nope")
        },
        { attempts: 3, delay: 0, retryIf: () => true },
      ),
    ).rejects.toThrow("nope")
    expect(calls).toBe(3)
  })

  test("matches transient messages case-insensitively", async () => {
    let calls = 0
    await expect(
      retry(
        async () => {
          calls += 1
          throw new Error("Failed To Fetch")
        },
        { attempts: 2, delay: 0 },
      ),
    ).rejects.toThrow()
    expect(calls).toBe(2)
  })
})
