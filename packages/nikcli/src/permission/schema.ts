import { Schema } from "effect"
import z from "zod"
import { zod } from "@/util/effect-zod"

const ActionSchema = Schema.Literal("ask", "allow", "deny").annotations({ identifier: "PermissionAction" })
export const Action = zod(ActionSchema)
export type Action = z.infer<typeof Action>

const RuleSchema = Schema.Struct({
  permission: Schema.String,
  pattern: Schema.String,
  action: ActionSchema,
}).annotations({ identifier: "PermissionRule" })
export const Rule = zod(RuleSchema)
export type Rule = z.infer<typeof Rule>

const RulesetSchema = Schema.Array(RuleSchema).annotations({ identifier: "PermissionRuleset" })
export const Ruleset = zod(RulesetSchema)
export type Ruleset = z.infer<typeof Ruleset>
