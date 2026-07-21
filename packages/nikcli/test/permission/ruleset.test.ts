import { describe, expect, it } from "bun:test"
import { PermissionRuleset } from "@/permission/ruleset"

describe("PermissionRuleset.disabled (opencode #38060)", () => {
  it("hides tools wholly denied via pattern='*'", () => {
    const ruleset: PermissionRuleset.Ruleset = [{ permission: "postman_*", pattern: "*", action: "deny" }]
    const disabled = PermissionRuleset.disabled(["postman_list", "postman_get", "bash"], ruleset)
    expect(disabled.has("postman_list")).toBe(true)
    expect(disabled.has("postman_get")).toBe(true)
    expect(disabled.has("bash")).toBe(false)
  })

  it("preserves tools denied only on a resource-scoped pattern (not '*')", () => {
    const ruleset: PermissionRuleset.Ruleset = [{ permission: "postman_*", pattern: "/admin/**", action: "deny" }]
    const disabled = PermissionRuleset.disabled(["postman_list", "bash"], ruleset)
    // resource-scoped deny does NOT hide the tool from the model
    expect(disabled.has("postman_list")).toBe(false)
    expect(disabled.has("bash")).toBe(false)
  })

  it("preserves tools allowed via pattern='*'", () => {
    const ruleset: PermissionRuleset.Ruleset = [{ permission: "bash", pattern: "*", action: "allow" }]
    const disabled = PermissionRuleset.disabled(["bash", "read"], ruleset)
    expect(disabled.has("bash")).toBe(false)
    expect(disabled.has("read")).toBe(false)
  })

  it("returns empty Set for empty ruleset", () => {
    const disabled = PermissionRuleset.disabled(["bash", "read"], [])
    expect(disabled.size).toBe(0)
  })

  it("collapses edit-style tools onto 'edit' permission for the lookup", () => {
    // edit, write, patch, multiedit all map to permission='edit'
    const ruleset: PermissionRuleset.Ruleset = [{ permission: "edit", pattern: "*", action: "deny" }]
    const disabled = PermissionRuleset.disabled(["edit", "write", "patch", "multiedit", "bash"], ruleset)
    expect(disabled.has("edit")).toBe(true)
    expect(disabled.has("write")).toBe(true)
    expect(disabled.has("patch")).toBe(true)
    expect(disabled.has("multiedit")).toBe(true)
    expect(disabled.has("bash")).toBe(false)
  })

  it("hides tool when the permission name itself matches a '*' deny rule", () => {
    const ruleset: PermissionRuleset.Ruleset = [{ permission: "bash", pattern: "*", action: "deny" }]
    const disabled = PermissionRuleset.disabled(["bash"], ruleset)
    expect(disabled.has("bash")).toBe(true)
  })
})
