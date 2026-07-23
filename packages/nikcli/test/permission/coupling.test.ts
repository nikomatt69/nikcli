import { describe, expect, it } from "bun:test"
import { PermissionRuleset } from "@/permission/ruleset"
import { Truncate } from "@/tool/truncation"

/**
 * Plan item 9 — explicit coupling regressions for monitor↔bash and
 * edit-family collapse. Companion coverage lives in `ruleset.test.ts`.
 */
describe("permission coupling", () => {
  it("disabled([monitor], bash deny) includes monitor", () => {
    const disabled = PermissionRuleset.disabled(
      ["monitor", "bash"],
      [{ permission: "bash", pattern: "*", action: "deny" }],
    )
    expect(disabled.has("monitor")).toBe(true)
    expect(disabled.has("bash")).toBe(true)
  })

  it("disabled([monitor], monitor deny) does NOT include monitor", () => {
    const disabled = PermissionRuleset.disabled(["monitor"], [{ permission: "monitor", pattern: "*", action: "deny" }])
    expect(disabled.has("monitor")).toBe(false)
  })

  it("edit-family tools share the edit permission for disabled()", () => {
    const disabled = PermissionRuleset.disabled(
      ["write", "apply_patch", "bash"],
      [{ permission: "edit", pattern: "*", action: "deny" }],
    )
    expect(disabled.has("write")).toBe(true)
    expect(disabled.has("apply_patch")).toBe(true)
    expect(disabled.has("bash")).toBe(false)
  })

  it("Truncate.DIR / Truncate.GLOB are concrete paths (not wildcard *)", () => {
    // ultrareview-reviewer (and peers) allow external_directory only for
    // these truncation paths — never via `"*": "allow"`.
    expect(Truncate.DIR).toBeTruthy()
    expect(Truncate.GLOB).toBeTruthy()
    expect(Truncate.DIR).not.toBe("*")
    expect(Truncate.GLOB).not.toBe("*")
  })
})
