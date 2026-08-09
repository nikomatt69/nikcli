import { describe, expect, it } from "bun:test"
import { catalogDescription } from "@/tool/skill"

/**
 * The tool description is paid on every request of every session. Listing each
 * skill's full description there cost ~16 KB for the bundled set — a quarter of
 * the whole model-visible tool surface — to answer a question most turns never
 * ask. Names go in the prompt; `search` fetches the rest on demand.
 *
 * This tests the catalog string directly rather than through `SkillTool.init()`,
 * because going through the tool means going through filesystem discovery, and
 * that makes the assertion depend on what the developer happens to have
 * installed and on which test file initialized the environment first.
 */

/** Long enough that eager listing would be unmistakable in the byte count. */
const BLURB = "Detailed guidance covering setup, pitfalls and verification. ".repeat(8).trim()

const skill = (name: string) => ({ name, description: BLURB, category: "testing", tags: ["a", "b"] })

describe("skill catalog description", () => {
  it("names every skill so the model knows it exists", () => {
    const text = catalogDescription([skill("alpha"), skill("beta"), skill("gamma")])
    expect(text).toContain("alpha")
    expect(text).toContain("beta")
    expect(text).toContain("gamma")
    expect(text).toContain("<available_skills>")
  })

  it("carries no descriptions, categories or tags", () => {
    const text = catalogDescription([skill("alpha"), skill("beta")])
    expect(text).not.toContain(BLURB)
    expect(text).not.toContain("testing")
    expect(text).not.toContain("<description>")
    expect(text).not.toContain("<skill>")
  })

  it("grows with the number of names, not with what the skills say", () => {
    const names = Array.from({ length: 40 }, (_, i) => skill(`fixture-${i}`))
    const text = catalogDescription(names)

    for (const s of names) expect(text).toContain(s.name)

    // Eager listing was names *plus* 40 × ~470 B of blurb. Landing anywhere near
    // that total means the catalog went back to spending the prompt on bodies.
    expect(text.length).toBeLessThan(BLURB.length * names.length * 0.25)
  })

  it("points the model at search instead of pretending the names are self-explanatory", () => {
    const text = catalogDescription([skill("alpha")])
    expect(text).toContain("skill({ search })")
    expect(text).toContain("skill({ name })")
  })

  it("says so plainly when there is nothing to load", () => {
    const text = catalogDescription([])
    expect(text).toContain("No skills are currently available")
    expect(text).not.toContain("<available_skills>")
  })
})
