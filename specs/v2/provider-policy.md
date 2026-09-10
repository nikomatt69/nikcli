# Provider policy

Status: **Accepted and implemented** (verified 2026-08-14).

Central rules now control provider availability consistently.

---

## Configure statements

Author ordered statements under `experimental.policies`:

```jsonc
{
  "experimental": {
    "policies": [
      { "effect": "deny", "action": "provider.use", "resource": "*" },
      { "effect": "allow", "action": "provider.use", "resource": "anthropic" },
    ],
  },
}
```

`experimental.policies` is an optional array of strict `Config.PolicyStatement` objects. Each statement requires `effect`, `action`, and `resource`; effects are `allow` or `deny`, while empty patterns and non-trailing wildcards are rejected.

---

## Match patterns

Actions and resources support exact values, the full `*` wildcard, and one trailing `*` prefix wildcard. For example, `provider.*` matches `provider.use`, and `open*` matches `openai` and `openrouter`; no other wildcard placement is valid.

---

## Resolve decisions

`Policy` in `src/policy/policy.ts` is the central evaluator. It checks matching statements in order, uses the last match, and allows by default when nothing matches.

This order supports deny-all followed by narrow allows, while later statements can override earlier ones.

---

## Keep compatibility

`Policy.statements` translates `enabled_providers` into a deny-all statement followed by allows for each listed id. It translates `disabled_providers` afterward, preserving the legacy denylist precedence when both fields contain the same id.

Authored `experimental.policies` follow the translated statements, so explicit rules can override legacy fields. Both legacy fields remain accepted but are deprecated in the config schema.

---

## Apply decisions

The `provider.use` decision is enforced while the provider catalog is built and while the HTTP provider list, CLI auth picker, and session auth picker are assembled. The three listing surfaces call `Policy.filter`; the catalog evaluates the same central statement list directly. The TUI disconnect path writes a deny statement.

The vocabulary is generic, but `plugin.load` and `mcp.connect` are not consumers in this implementation.

---

## Disconnect accounts

Disconnecting a non-API provider in the TUI appends a `deny` statement for its `provider.use` resource when an identical deny is not already present. It no longer mutates `disabled_providers`.

---

## Verify behavior

`test/policy/policy.test.ts` covers default allow, ordered last-match-wins, full and trailing-prefix wildcards, legacy translation and precedence, explicit overrides, map filtering, and schema validation. `test/server/httpapi-provider.test.ts` checks that a legacy allowlist hides other providers from `GET /provider`. The TUI disconnect write does not have a focused test.
