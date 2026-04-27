import { describe, expect, it } from "bun:test"
import { Action, Rule, Ruleset } from "@/permission/schema"

describe("permission schema", () => {
  describe("Action", () => {
    it("accepts ask, allow, deny", () => {
      expect(Action.parse("ask")).toBe("ask")
      expect(Action.parse("allow")).toBe("allow")
      expect(Action.parse("deny")).toBe("deny")
    })

    it("rejects unknown actions", () => {
      expect(() => Action.parse("block" as any)).toThrow()
    })
  })

  describe("Rule", () => {
    it("parses a valid rule", () => {
      const rule = Rule.parse({
        permission: "bash",
        pattern: "**",
        action: "ask",
      })
      expect(rule).toEqual({
        permission: "bash",
        pattern: "**",
        action: "ask",
      })
    })

    it("rejects missing fields", () => {
      expect(() => Rule.parse({ permission: "x", pattern: "y" } as any)).toThrow()
    })
  })

  describe("Ruleset", () => {
    it("parses an array of rules", () => {
      const set = Ruleset.parse([
        { permission: "read", pattern: "*.ts", action: "allow" },
        { permission: "write", pattern: "/tmp/**", action: "deny" },
      ])
      expect(set).toHaveLength(2)
      expect(set[0]?.action).toBe("allow")
    })

    it("accepts empty ruleset", () => {
      expect(Ruleset.parse([])).toEqual([])
    })
  })
})
