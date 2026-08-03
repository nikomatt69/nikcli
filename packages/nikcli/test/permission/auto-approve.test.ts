import { describe, expect, it } from "bun:test"
import { PermissionRuleset } from "@/permission/ruleset"

const evaluate = (ruleset: PermissionRuleset.Ruleset, permission: string, pattern = "*") =>
  PermissionRuleset.evaluate(permission, pattern, ruleset).action

describe("PermissionRuleset.autoApprove", () => {
  it("turns asks into allows", () => {
    const base: PermissionRuleset.Ruleset = [
      { permission: "*", pattern: "*", action: "allow" },
      { permission: "bash", pattern: "*", action: "ask" },
      { permission: "browser_control", pattern: "*", action: "ask" },
    ]

    const auto = PermissionRuleset.autoApprove(base)

    expect(evaluate(base, "bash")).toBe("ask")
    expect(evaluate(auto, "bash")).toBe("allow")
    expect(evaluate(auto, "browser_control")).toBe("allow")
  })

  it("keeps explicit denials in force", () => {
    // A denial is a rail the user deliberately set. "Do not stop to ask" must not become
    // "ignore what I switched off".
    const base: PermissionRuleset.Ruleset = [
      { permission: "*", pattern: "*", action: "ask" },
      { permission: "bash", pattern: "rm *", action: "deny" },
    ]

    const auto = PermissionRuleset.autoApprove(base)

    expect(evaluate(auto, "bash", "ls")).toBe("allow")
    expect(evaluate(auto, "bash", "rm -rf build")).toBe("deny")
  })

  it("does not resurrect a denial that a later rule already overrode", () => {
    const base: PermissionRuleset.Ruleset = [
      { permission: "question", pattern: "*", action: "deny" },
      { permission: "question", pattern: "*", action: "allow" },
    ]

    expect(evaluate(PermissionRuleset.autoApprove(base), "question")).toBe("allow")
  })

  it("allows a permission that had no rule at all", () => {
    expect(evaluate(PermissionRuleset.autoApprove([]), "anything")).toBe("allow")
  })

  it("merges several rulesets before rewriting them", () => {
    const defaults: PermissionRuleset.Ruleset = [{ permission: "*", pattern: "*", action: "ask" }]
    const user: PermissionRuleset.Ruleset = [{ permission: "edit", pattern: "*", action: "deny" }]

    const auto = PermissionRuleset.autoApprove(defaults, user)

    expect(evaluate(auto, "bash")).toBe("allow")
    expect(evaluate(auto, "edit")).toBe("deny")
  })
})
