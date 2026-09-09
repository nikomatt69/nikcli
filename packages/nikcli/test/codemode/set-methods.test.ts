import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { CodeMode } from "../../src/codemode/index"

// Set composition and grouping are orchestration work: "which paths did both greps return?" and
// "group these results by status" are things the model asks of tool output, not of an application.
const run = (code: string) => Effect.runPromise(CodeMode.make({ tools: {} }).execute(code))

const value = async (code: string) => {
  const result = await run(code)
  if (!result.ok) throw new Error(`expected success, got ${result.error.kind}: ${result.error.message}`)
  return result.value
}
const failure = async (code: string) => {
  const result = await run(code)
  if (result.ok) throw new Error(`expected failure, got ${JSON.stringify(result.value)}`)
  return result.error
}

describe("set composition", () => {
  test.each([
    ["union", `return [...new Set([1, 2]).union(new Set([3]))]`, [1, 2, 3]],
    ["intersection", `return [...new Set([1, 2]).intersection(new Set([2, 3]))]`, [2]],
    ["difference", `return [...new Set([1, 2]).difference(new Set([2]))]`, [1]],
    ["symmetricDifference", `return [...new Set([1, 2]).symmetricDifference(new Set([2, 3]))]`, [1, 3]],
    ["isSubsetOf", `return new Set([1]).isSubsetOf(new Set([1, 2]))`, true],
    ["isSupersetOf", `return new Set([1, 2]).isSupersetOf(new Set([1]))`, true],
    ["isDisjointFrom", `return new Set([1]).isDisjointFrom(new Set([2]))`, true],
  ])("%s", async (_name, code, expected) => {
    expect(await value(code)).toEqual(expected)
  })

  test("the result is a Set facade, not a host Set", async () => {
    expect(await value(`return new Set([1]).union(new Set([2])).size`)).toBe(2)
    expect(await value(`return new Set([1]).union(new Set([2])).has(2)`)).toBe(true)
  })

  test("the source sets are not mutated", async () => {
    expect(await value(`const a = new Set([1]); a.union(new Set([2])); return a.size`)).toBe(1)
  })

  // The real methods accept any set-like. Accepting an array here would make `s.union([1,2])` return
  // a wrong answer quietly, which is worse than refusing it.
  test("an array argument is refused rather than coerced", async () => {
    expect((await failure(`return new Set([1]).union([2])`)).message).toStartWith("Set.union expects another Set.")
  })
})

describe("groupBy", () => {
  test("Object.groupBy keys by the stringified group", async () => {
    expect(await value(`return JSON.stringify(Object.groupBy([1, 2, 3], (n) => (n % 2 ? "odd" : "even")))`)).toBe(
      `{"odd":[1,3],"even":[2]}`,
    )
  })

  test("Map.groupBy keys by the raw value", async () => {
    expect(
      await value(`const m = Map.groupBy([1, 2, 3], (n) => n % 2); return [m.get(1).length, m.get(0).length]`),
    ).toEqual([2, 1])
  })

  test("the callback receives the index", async () => {
    expect(await value(`return JSON.stringify(Object.groupBy(["a", "b"], (_item, index) => index))`)).toBe(
      `{"0":["a"],"1":["b"]}`,
    )
  })

  test("a non-function callback is refused", async () => {
    expect((await failure(`return Object.groupBy([1], 5)`)).message).toStartWith(
      "Object.groupBy expects a function callback.",
    )
  })

  // Grouping is keyed by model-chosen strings, so the prototype-pollution guard has to hold here too.
  test("a dangerous group key is refused", async () => {
    expect((await failure(`return Object.groupBy([1], () => "__proto__")`)).message).toContain("is not available")
  })
})
