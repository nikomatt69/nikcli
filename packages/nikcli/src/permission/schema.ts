import z from "zod"

export const Action = z.enum(["ask", "allow", "deny"]).meta({
  ref: "PermissionAction",
})
export type Action = z.infer<typeof Action>

export const Rule = z
  .object({
    permission: z.string(),
    pattern: z.string(),
    action: Action,
  })
  .meta({
    ref: "PermissionRule",
  })
export type Rule = z.infer<typeof Rule>

export const Ruleset = Rule.array().meta({
  ref: "PermissionRuleset",
})
export type Ruleset = z.infer<typeof Ruleset>
