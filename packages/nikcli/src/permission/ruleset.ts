import { Log } from "@nikcli-ai/util/log"
import { Wildcard } from "@/util/wildcard"
import { zod, zodObject } from "@nikcli-ai/util/effect-zod"
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

  /**
   * The "Full access" preset as a ruleset: every tool allowed without a prompt,
   * except the three internal permissions that must stay denied so an
   * unattended agent can never park itself waiting for a human
   * (`question`) or flip the session into plan mode.
   *
   * Mirrors `permissionPresetPatch("full_access")` in the TUI
   * (`cli/cmd/tui/util/permission-presets.ts`); `evaluate` picks the *last*
   * matching rule, so the deny entries must stay after the `*` allow.
   *
   * Used by unattended runners (loops, missions) which have no user to answer
   * an `ask` — see `worktree/sandbox.ts` for why that is only safe inside an
   * isolated worktree.
   */
  export function fullAccess(): Ruleset {
    return [
      { permission: "*", pattern: "*", action: "allow" },
      { permission: "question", pattern: "*", action: "deny" },
      { permission: "plan_enter", pattern: "*", action: "deny" },
      { permission: "plan_exit", pattern: "*", action: "deny" },
    ]
  }

  /**
   * Rewrites a ruleset so nothing stops to ask, while keeping explicit denials in force.
   *
   * Auto-approval means "do not pause for confirmation" — it does not mean "ignore the safety rails
   * the user configured". A `deny` is something the user deliberately switched off, so it survives;
   * everything else becomes `allow`. Because {@link evaluate} takes the *last* matching rule, the
   * surviving denials are appended after the blanket allow so they still win.
   *
   * Only denials that are still in effect are carried over: a rule that a later rule already
   * overrode must not come back to life here.
   */
  export function autoApprove(...rulesets: Ruleset[]): Ruleset {
    const effective = new Map<string, Rule>()
    // NUL separates the two halves of the key because it cannot occur in a
    // permission or a pattern. Keep it written as `\u0000`: a literal NUL byte
    // in the source makes this file read as binary, and grep/ripgrep then
    // silently report no matches for anything in it, TOOL_PERMISSION included.
    for (const rule of merge(...rulesets)) effective.set(`${rule.permission}\u0000${rule.pattern}`, rule)
    return [
      { permission: "*", pattern: "*", action: "allow" },
      ...[...effective.values()].filter((rule) => rule.action === "deny"),
    ]
  }

  export function evaluate(permission: string, pattern: string, ...rulesets: Ruleset[]): Rule {
    const merged = merge(...rulesets)
    // debug + count only: stringifying the full ruleset on every tool call is
    // measurable overhead at the default INFO level.
    log.debug("evaluate", { permission, pattern, rules: merged.length })
    const match = merged.findLast(
      (rule: Rule) => Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern),
    )
    const decision = match ?? { action: "ask" as const, permission, pattern: "*" }

    // `specs/effect-tui/17-sandbox-permission-boundaries.md` requirement 10:
    // every decision is auditable with the rule that produced it, never the
    // ruleset that contained it — the four fields below are cheap on a hot
    // path where stringifying the whole list is not, and they are what an
    // operator reconstructing "why was this allowed" actually needs.
    //
    // A deny is the one outcome that changes what the user sees without
    // telling them, so it is reported at a level they will have on. `allow`
    // and `ask` stay at debug: one is the common case and the other announces
    // itself with a prompt.
    const audit = {
      permission,
      pattern,
      outcome: decision.action,
      rule: `${decision.permission} ${decision.pattern}`,
      matched: match !== undefined,
    }
    if (decision.action === "deny") log.info("permission denied", audit)
    else log.debug("permission decided", audit)

    return decision
  }

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
  /**
   * `specs/effect-tui/17-sandbox-permission-boundaries.md` treats this map as
   * settled: a rule on a parent tool covers its coupled children, never the
   * reverse. That spec adds the sandbox, network policy, and audit boundary
   * around it — it does not relax these entries.
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
