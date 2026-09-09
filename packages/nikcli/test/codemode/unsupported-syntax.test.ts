import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { CodeMode } from "../../src/codemode/index"

// The exclusions are decisions, not gaps waiting to be filled. What they have to do is refuse in a
// way that ends the attempt: name the construct, name the replacement, and say so in the shared hint
// as well — a model that only reads a list it is not on retries the same construct differently.
// The full matrix is specs/v2/codemode-interpreter-support.md.
const run = (code: string) => Effect.runPromise(CodeMode.make({ tools: {} }).execute(code))

const failure = async (code: string) => {
  const result = await run(code)
  if (result.ok) throw new Error(`expected failure, got ${JSON.stringify(result.value)}`)
  return result.error
}

describe("deliberate exclusions", () => {
  test("generator functions name the replacement", async () => {
    const error = await failure(`function* g() { yield 1 } return [...g()]`)
    expect(error.kind).toBe("UnsupportedSyntax")
    expect(error.message).toContain("Generator functions are not supported")
    expect(error.message).toContain("Promise.all")
  })

  test("for await...of names the replacement", async () => {
    const error = await failure(`async function* g() { yield 1 } for await (const x of g()) {} return 1`)
    expect(error.kind).toBe("UnsupportedSyntax")
    expect(error.message).toContain("not supported")
  })

  test("for await over a plain array is refused too, not silently sequential", async () => {
    const error = await failure(`for await (const x of [Promise.resolve(1)]) {} return 1`)
    expect(error.kind).toBe("UnsupportedSyntax")
    expect(error.message).toContain("for await...of is not supported")
    expect(error.message).toContain("Promise.all")
  })

  test("classes stay unsupported syntax", async () => {
    expect((await failure(`class A {} return new A()`)).kind).toBe("UnsupportedSyntax")
  })
})

describe("the shared hint", () => {
  test("names what is unsupported, not only what is supported", async () => {
    const error = await failure(`class A {} return 1`)
    const hint = error.suggestions?.[0] ?? ""
    for (const excluded of ["generator", "for await...of", "classes", "this"]) {
      expect(hint).toContain(excluded)
    }
  })

  test("names the control flow that was added, so it is not assumed absent", async () => {
    const hint = (await failure(`class A {} return 1`)).suggestions?.[0] ?? ""
    expect(hint).toContain("labelled loops")
  })
})
