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

  /**
   * Explicit tool→permission mapping. Each entry maps a tool id to the
   * permission string the ruleset is evaluated against. Tools not listed
   * here are evaluated against their own id (`tool === permission`),
   * which is the historical default and remains correct for most tools.
   *
   * Add new entries here when a tool delegates to a different permission
   * than its own id. Keeping the table explicit avoids the implicit
   * "monitor asks for bash" or "apply_patch asks for patch" coupling
   * that bit callers in the past — the comment next to each entry
   * documents the delegation so the seam is discoverable.
   */
  export const TOOL_PERMISSION: Record<string, string> = {
    // monitor runs a shell command asynchronously; it shares the
    // `bash` permission with the synchronous `bash` tool so a user who
    // denies `bash` for an agent also denies `monitor`.
    monitor: "bash",
    // The edit-tool family collapses to a single `edit` permission so
    // a "deny edit" rule covers all four shapes (string-replace edit,
    // full write, multi-edit, GPT-style apply_patch).
    edit: "edit",
    write: "edit",
    patch: "edit",
    multiedit: "edit",
    apply_patch: "edit",
  }

  export function disabled(tools: string[], ruleset: Ruleset): Set<string> {
    const result = new Set<string>()
    for (const tool of tools) {
      const permission = TOOL_PERMISSION[tool] ?? tool

      const rule = ruleset.findLast((r: Rule) => Wildcard.match(permission, r.permission))
      if (!rule) continue
      if (rule.pattern === "*" && rule.action === "deny") result.add(tool)
    }
    return result
  }
}
