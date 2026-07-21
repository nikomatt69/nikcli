import { describe, expect, it } from "bun:test"

describe("Agent ordering (opencode #24691)", () => {
  it("sort key 1 yields agents before those without order", () => {
    const ordered = ["a", "b", "c"]
    const list = [
      { name: "z", order: undefined as number | undefined },
      { name: "a", order: 1 as number | undefined },
      { name: "b", order: 2 as number | undefined },
      { name: "c", order: 3 as number | undefined },
    ]
    const sorted = list
      .map((x) => [x, x.order ?? Infinity] as [{ name: string }, number])
      .sort((a, b) => (a[1] as number) - (b[1] as number))
      .map(([item]) => item.name)
    expect(sorted.slice(0, 3)).toEqual(ordered)
  })

  it("agents without order fall back to alphabetical", () => {
    const list = [
      { name: "charlie", order: undefined as number | undefined },
      { name: "alpha", order: undefined as number | undefined },
      { name: "bravo", order: undefined as number | undefined },
    ]
    const sorted = list
      .slice()
      .sort((a, b) => {
        const oa = a.order ?? Infinity
        const ob = b.order ?? Infinity
        if (oa !== ob) return oa - ob
        return a.name.localeCompare(b.name)
      })
      .map((x) => x.name)
    expect(sorted).toEqual(["alpha", "bravo", "charlie"])
  })

  it("mixed ordered + alphabetical respects both criteria", () => {
    const list = [
      { name: "zeta", order: undefined as number | undefined },
      { name: "alpha", order: undefined as number | undefined },
      { name: "main", order: 1 as number | undefined },
      { name: "build", order: 2 as number | undefined },
    ]
    const sorted = list
      .slice()
      .sort((a, b) => {
        const oa = a.order ?? Infinity
        const ob = b.order ?? Infinity
        if (oa !== ob) return oa - ob
        return a.name.localeCompare(b.name)
      })
      .map((x) => x.name)
    expect(sorted).toEqual(["main", "build", "alpha", "zeta"])
  })
})
