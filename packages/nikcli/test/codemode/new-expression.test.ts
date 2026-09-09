import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { CodeMode } from "../../src/codemode/index"

// `new` is supported syntax; only the callee decides whether construction succeeds. Reporting these
// as `UnsupportedSyntax` told the model that `new` itself was unavailable, one line after a hint
// saying `new Promise(...)` works — so it is a TypeError naming the callee, like JS.
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
// Errors surface their name only when the program catches them, so read it from inside.
const caught = (code: string) => value(`try { ${code} } catch (error) { return [error.name, error.message] }`)

describe("new on a non-constructible callee", () => {
  test("a user-defined function names the documented gap", async () => {
    expect(await caught(`function Point(x) { return { x } } return new Point(1)`)).toEqual([
      "TypeError",
      "Point cannot be constructed: user-defined constructors and classes are not supported. Call it as a function that returns a plain object instead.",
    ])
  })

  test("a built-in that is not constructible points at the plain call", async () => {
    expect(await caught(`return new Math.abs(1)`)).toEqual([
      "TypeError",
      "new Math.abs(...) is not supported; call Math.abs(...) without new instead.",
    ])
  })

  test("a plain value is not a constructor", async () => {
    expect(await caught(`return new (1)()`)).toEqual(["TypeError", "The called value is not a constructor."])
  })

  // The bug this guards: the builtin table was keyed by name, so a redefined `Date` still built a
  // real date out of a number the program had already replaced.
  test("a shadowed built-in is judged on the binding in scope", async () => {
    expect(await caught(`const Date = 5; return new Date()`)).toEqual(["TypeError", "Date is not a constructor."])
  })

  test("an undeclared callee still fails as an unknown identifier", async () => {
    const error = await failure(`return new Nope()`)
    expect(error.message).toContain("Nope")
    expect(error.message).not.toContain("not a constructor")
  })

  test("the refusal is not reported as unsupported syntax", async () => {
    expect((await failure(`return new (1)()`)).kind).not.toBe("UnsupportedSyntax")
  })

  test("the constructors that do exist are untouched", async () => {
    expect(await value(`return await new Promise((resolve) => resolve(7))`)).toBe(7)
    expect(await value(`return new Set([1, 2]).size`)).toBe(2)
    expect(await value(`return new Map([["a", 1]]).get("a")`)).toBe(1)
    expect(await value(`return new URL("https://example.com/a").pathname`)).toBe("/a")
  })
})

describe("calling a member that is not a function", () => {
  // Facades resolve an unknown property to `undefined` so `if (value.maybe)` still works; calling it
  // used to arrive as "Only tools are callable", pointing at tools when one method was the problem.
  test("names the member instead of blaming tools", async () => {
    expect(await caught(`return new Set([1]).nope()`)).toEqual(["TypeError", "nope is not a function."])
    expect(await caught(`return ({ a: 1 }).nope()`)).toEqual(["TypeError", "nope is not a function."])
  })
})
