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

describe("PermissionRuleset.TOOL_PERMISSION (explicit coupling table)", () => {
  it("maps monitor to the bash permission", () => {
    expect(PermissionRuleset.TOOL_PERMISSION.monitor).toBe("bash")
  })

  it("collapses the edit family to the edit permission", () => {
    expect(PermissionRuleset.TOOL_PERMISSION.edit).toBe("edit")
    expect(PermissionRuleset.TOOL_PERMISSION.write).toBe("edit")
    expect(PermissionRuleset.TOOL_PERMISSION.patch).toBe("edit")
    expect(PermissionRuleset.TOOL_PERMISSION.multiedit).toBe("edit")
    expect(PermissionRuleset.TOOL_PERMISSION.apply_patch).toBe("edit")
  })

  it("disables monitor when bash is denied", () => {
    const ruleset: PermissionRuleset.Ruleset = [{ permission: "bash", pattern: "*", action: "deny" }]
    const disabled = PermissionRuleset.disabled(["monitor"], ruleset)
    expect(disabled.has("monitor")).toBe(true)
  })

  it("does not disable monitor via a monitor-only deny rule (the coupling is one-way)", () => {
    // A rule keyed on `permission: "monitor"` does not match because
    // disabled() looks up via TOOL_PERMISSION which maps monitor -> bash.
    // To deny monitor, deny bash. This is the documented invariant in
    // src/tool/monitor.ts.
    const ruleset: PermissionRuleset.Ruleset = [{ permission: "monitor", pattern: "*", action: "deny" }]
    const disabled = PermissionRuleset.disabled(["monitor"], ruleset)
    expect(disabled.has("monitor")).toBe(false)
  })

  it("disables all edit-family tools when edit is denied", () => {
    const ruleset: PermissionRuleset.Ruleset = [{ permission: "edit", pattern: "*", action: "deny" }]
    const disabled = PermissionRuleset.disabled(["edit", "write", "patch", "multiedit", "apply_patch"], ruleset)
    expect(disabled.has("edit")).toBe(true)
    expect(disabled.has("write")).toBe(true)
    expect(disabled.has("patch")).toBe(true)
    expect(disabled.has("multiedit")).toBe(true)
    expect(disabled.has("apply_patch")).toBe(true)
  })

  it("preserves tools that are not in the explicit table", () => {
    // `read` is not in TOOL_PERMISSION; lookup uses tool id directly.
    const ruleset: PermissionRuleset.Ruleset = [{ permission: "read", pattern: "*", action: "deny" }]
    const disabled = PermissionRuleset.disabled(["read", "glob"], ruleset)
    expect(disabled.has("read")).toBe(true)
    expect(disabled.has("glob")).toBe(false)
  })
})
