import { Log } from "@/util/log"
import { Wildcard } from "@/util/wildcard"
import { zod, zodObject } from "@/util/effect-zod"
import { Schema } from "effect"
import os from "os"
import type { Config } from "@/config/config"

// Pure permission-ruleset model and evaluator, split out of PermissionNext so
// light clients (tool truncation, the TUI) can evaluate rules without pulling
// the stateful permission service and its drizzle-backed repo.
export namespace PermissionRuleset {
  const log = Log.create({ service: "permission" })

  export function expand(pattern: string): string {
    if (pattern.startsWith("~/")) return os.homedir() + pattern.slice(1)
    if (pattern === "~") return os.homedir()
    if (pattern.startsWith("$HOME/")) return os.homedir() + pattern.slice(5)
    if (pattern.startsWith("$HOME")) return os.homedir() + pattern.slice(5)
    return pattern
  }

  export const ActionSchema = Schema.Literals(["allow", "deny", "ask"]).annotate({
    identifier: "PermissionAction",
  })
  export const Action = zod(ActionSchema)
  export type Action = Schema.Schema.Type<typeof ActionSchema>

  export const RuleSchema = Schema.Struct({
    permission: Schema.String,
    pattern: Schema.String,
    action: ActionSchema,
  }).annotate({ identifier: "PermissionRule" })
  export const Rule = zodObject(RuleSchema)
  export type Rule = Schema.Schema.Type<typeof RuleSchema>

  export const RulesetSchema = Schema.mutable(Schema.Array(RuleSchema)).annotate({
    identifier: "PermissionRuleset",
  })
  export const Ruleset = zod(RulesetSchema)
  export type Ruleset = Schema.Schema.Type<typeof RulesetSchema>

  export function fromConfig(permission: Config.Permission) {
    const ruleset: Ruleset = []
    for (const [key, value] of Object.entries(permission)) {
      if (typeof value === "string") {
        ruleset.push({
          permission: key,
          action: value,
          pattern: "*",
        })
        continue
      }
      ruleset.push(
        ...Object.entries(value).map(([pattern, action]) => ({
          permission: key,
          pattern: expand(pattern),
          action,
        })),
      )
    }
    return ruleset
  }

  export function merge(...rulesets: Ruleset[]): Ruleset {
    return rulesets.flat()
  }

  export function evaluate(permission: string, pattern: string, ...rulesets: Ruleset[]): Rule {
    const merged = merge(...rulesets)
    // debug + count only: stringifying the full ruleset on every tool call is
    // measurable overhead at the default INFO level.
    log.debug("evaluate", { permission, pattern, rules: merged.length })
    const match = merged.findLast(
      (rule: Rule) => Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern),
    )
    return match ?? { action: "ask", permission, pattern: "*" }
  }

  const EDIT_TOOLS = ["edit", "write", "patch", "multiedit"]

  export function disabled(tools: string[], ruleset: Ruleset): Set<string> {
    const result = new Set<string>()
    for (const tool of tools) {
      const permission = EDIT_TOOLS.includes(tool) ? "edit" : tool

      const rule = ruleset.findLast((r: Rule) => Wildcard.match(permission, r.permission))
      if (!rule) continue
      if (rule.pattern === "*" && rule.action === "deny") result.add(tool)
    }
    return result
  }
}
