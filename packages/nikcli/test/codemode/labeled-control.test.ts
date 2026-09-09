import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { CodeMode } from "../../src/codemode/index"

// Labelled break/continue exist here for one shape the model writes constantly: a scan over an outer
// collection that gives up on the current item from inside a nested loop. Without labels that is a
// flag variable checked after the inner loop, which is where off-by-one bugs live.
const run = (code: string) => Effect.runPromise(CodeMode.make({ tools: {} }).execute(code))

const value = async (code: string) => {
  const result = await run(code)
  if (!result.ok) throw new Error(`expected success, got ${result.error.kind}: ${result.error.message}`)
  return result.value
}

describe("labelled control flow", () => {
  test("continue skips the rest of the labelled iteration", async () => {
    expect(
      await value(`
        const seen = []
        outer: for (const a of [1, 2]) {
          for (const b of [1, 2]) {
            if (b === 2) continue outer
            seen.push(a + "-" + b)
          }
          seen.push("unreachable")
        }
        return seen.join(",")
      `),
    ).toBe("1-1,2-1")
  })

  test("break leaves the labelled loop, not just the inner one", async () => {
    expect(
      await value(`
        const seen = []
        outer: for (const a of [1, 2]) {
          for (const b of [1, 2]) {
            seen.push(a + "-" + b)
            if (b === 2) break outer
          }
        }
        return seen.join(",")
      `),
    ).toBe("1-1,1-2")
  })

  test("a labelled block is left by break", async () => {
    expect(await value(`let x = 1; block: { x = 2; break block; x = 3 } return x`)).toBe(2)
  })

  test.each([
    [
      "while",
      `let i = 0, n = 0; outer: while (i < 3) { i++; let j = 0; while (j < 3) { j++; if (j === 2) continue outer; n++ } } return n`,
      3,
    ],
    [
      "do-while",
      `let i = 0, n = 0; outer: do { i++; n++; if (i < 3) continue outer } while (i < 3); return i + "," + n`,
      "3,3",
    ],
    [
      "for-in",
      `const out = []; outer: for (const k in { a: 1, b: 2 }) { for (const j in { x: 1, y: 2 }) { out.push(k + j); continue outer } } return out.join(",")`,
      "ax,bx",
    ],
  ])("labels reach a %s loop", async (_form, code, expected) => {
    expect(await value(code)).toEqual(expected)
  })

  // The update clause still has to run, or `continue outer` on a classic for loop hangs forever.
  test("continue on a classic for loop still advances the counter", async () => {
    expect(
      await value(`
        const out = []
        outer: for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 3; j++) { if (j === 1) continue outer }
          out.push(i)
        }
        return out.length
      `),
    ).toBe(0)
  })

  test("a labelled break travels out through a switch", async () => {
    expect(
      await value(`
        const out = []
        outer: for (const a of [1, 2, 3]) {
          switch (a) {
            case 2: break outer
            default: out.push(a)
          }
        }
        return out.join(",")
      `),
    ).toBe("1")
  })

  // The other half of that: a bare break inside a switch must still mean the switch.
  test("a bare break inside a switch stays local to it", async () => {
    expect(
      await value(`
        const out = []
        for (const a of [1, 2, 3]) {
          switch (a) {
            case 2: break
            default: out.push(a)
          }
          out.push("after" + a)
        }
        return out.join(",")
      `),
    ).toBe("1,after1,after2,3,after3")
  })

  test("unlabelled break and continue are unchanged", async () => {
    expect(
      await value(`let n = 0; for (const a of [1, 2, 3]) { if (a === 2) continue; if (a === 3) break; n++ } return n`),
    ).toBe(1)
  })

  test("return still wins over any enclosing label", async () => {
    expect(
      await value(`outer: for (const a of [1, 2]) { for (const b of [1, 2]) { return "early" } } return "late"`),
    ).toBe("early")
  })
})
