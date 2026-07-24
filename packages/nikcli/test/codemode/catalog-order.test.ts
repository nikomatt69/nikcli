import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { CodeMode, Tool } from "../../src/codemode/index"

const stub = (description: string) =>
  Tool.make({
    description,
    input: Schema.Struct({}),
    output: Schema.String,
    run: () => Effect.succeed("ok"),
  })

const alpha = stub("Alpha tool")
const zeta = stub("Zeta tool")
const middle = stub("Middle tool")

describe("Code Mode catalog ordering", () => {
  // `Object.entries` flattening preserves insertion order, so without a canonical sort
  // an unchanged tool reload renders different catalog bytes, changes the instruction
  // hash, and busts the prompt cache for nothing.
  test("renders identical instructions regardless of tool insertion order", () => {
    const forward = CodeMode.make({ tools: { ns: { alpha, middle, zeta } } }).instructions()
    const reverse = CodeMode.make({ tools: { ns: { zeta, middle, alpha } } }).instructions()

    expect(reverse).toBe(forward)
  })

  test("renders identical instructions regardless of namespace insertion order", () => {
    const forward = CodeMode.make({ tools: { aaa: { alpha }, zzz: { zeta } } }).instructions()
    const reverse = CodeMode.make({ tools: { zzz: { zeta }, aaa: { alpha } } }).instructions()

    expect(reverse).toBe(forward)
  })

  test("orders the catalog by canonical dotted path", () => {
    const instructions = CodeMode.make({ tools: { ns: { zeta, alpha, middle } } }).instructions()
    const positions = ["ns.alpha", "ns.middle", "ns.zeta"].map((path) => instructions.indexOf(path))

    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((left, right) => left - right))
  })

  test("orders by code unit, not host locale", () => {
    // `localeCompare` sorts these differently depending on the active locale, which
    // would make the same tool set render different bytes on different machines.
    const forward = CodeMode.make({ tools: { ns: { Zebra: alpha, apple: zeta } } }).instructions()
    const reverse = CodeMode.make({ tools: { ns: { apple: zeta, Zebra: alpha } } }).instructions()

    expect(reverse).toBe(forward)
    expect(forward.indexOf("ns.Zebra")).toBeLessThan(forward.indexOf("ns.apple"))
  })
})
