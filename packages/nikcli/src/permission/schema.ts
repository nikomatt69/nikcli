import { Schema } from "effect"
import z from "zod"
import { zod } from "@nikcli-ai/util/effect-zod"

const ActionSchema = Schema.Literals(["ask", "allow", "deny"]).annotate({ identifier: "PermissionAction" })
export const Action = zod(ActionSchema)
export type Action = z.infer<typeof Action>

const RuleSchema = Schema.Struct({
  permission: Schema.String,
  pattern: Schema.String,
  action: ActionSchema,
}).annotate({ identifier: "PermissionRule" })
export const Rule = zod(RuleSchema)
export type Rule = z.infer<typeof Rule>

const RulesetSchema = Schema.Array(RuleSchema).annotate({ identifier: "PermissionRuleset" })
export const Ruleset = zod(RulesetSchema)
export type Ruleset = z.infer<typeof Ruleset>
