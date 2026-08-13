# Provider Policy

| Field  | Value                                                        |
| ------ | ------------------------------------------------------------ |
| Status | **Proposed and unimplemented**                               |
| Scope  | `src/config/config.ts`, `src/provider/provider.ts`, and the four other call sites listed below |
| Buys   | One evaluation point instead of five copies, and a vocabulary that extends past providers |

## Purpose

A policy controls whether an operation on a named resource is allowed. Statements are authored in configuration and evaluated in one place.

The first consumer is provider availability:

```text
action:   provider.use
resource: provider id, such as anthropic or nikcli
```

Provider **configuration** and provider **policy** stay separate:

- `provider` describes endpoints, options, credentials, and model overrides.
- `experimental.policies` decides whether an operation using a provider is allowed.

A provider can be correctly configured, hold valid credentials, and still be denied by policy.

## Current Behavior

Two config fields express availability:

```ts
disabled_providers?: string[]   // "Disable providers that are loaded automatically"
enabled_providers?: string[]    // "When set, ONLY these providers will be enabled"
```

The evaluation is trivial — deny if an allowlist exists and misses, deny if the denylist hits — and it is **written out five times**:

| Call site                                        | Consumer                                     |
| ------------------------------------------------ | -------------------------------------------- |
| `src/provider/provider.ts` (`isProviderAllowed`) | The catalog the model resolver sees          |
| `src/server/httpapi/provider.ts`                 | The provider list served to clients          |
| `src/cli/cmd/auth.ts`                            | The provider picker in `nikcli auth`         |
| `src/session/auth.ts`                            | Session-scoped auth listing                  |
| `src/cli/cmd/tui/component/dialog-provider.tsx`  | The TUI toggle, which writes `disabled_providers` directly |

Four of the five reimplement the same two lines with slightly different types (`null` vs `undefined` for "no allowlist"), and the fifth mutates the array from the UI. Nothing prevents a sixth consumer from getting the precedence backwards, and there is no place to add a rule that is not provider-shaped.

The fields also cannot express anything beyond membership: no wildcards, no ordering, no per-scope override, and no vocabulary for `plugin.load` or `mcp.connect`, which will want the same treatment.

## Goals

- Replace `enabled_providers` and `disabled_providers` with one ordered statement list.
- Keep the default experience identical when no policy is authored.
- Support wildcards for both action and resource.
- Provide one small vocabulary that later covers operations such as `plugin.load` and `mcp.connect`.
- Let user policy override repository policy, and leave room for an organization-managed layer above both.
- Keep evaluation simple: matching statements apply in order, last match wins.

## Non-Goals

- Policies do not configure endpoints, credentials, models, or provider options.
- Policies do not make an unusable resource usable. Denying `provider.use` on a provider with no credentials changes nothing; allowing it does not create credentials.
- No conditions, principals, approval prompts, or enforced configuration values in this iteration.
- How organization-managed policy is delivered is out of scope.

## Statement Shape

```jsonc
{
  "experimental": {
    "policies": [
      { "effect": "deny",  "action": "provider.use", "resource": "*" },
      { "effect": "allow", "action": "provider.use", "resource": "anthropic" },
      { "effect": "allow", "action": "provider.use", "resource": "nikcli" }
    ]
  }
}
```

- `effect` is `"allow"` or `"deny"`.
- `action` and `resource` accept `*` as a full wildcard and a trailing `*` as a prefix wildcard.
- Statements evaluate in order; the **last** matching statement wins. An empty policy list allows everything, which is what preserves today's default.

Ordering by last-match is chosen over "deny always wins" because it makes deny-all-then-allow-a-few expressible in three lines, which is the shape most users of `enabled_providers` actually want.

## Evaluation

One function, one call site per decision:

```ts
Policy.allows({ action: "provider.use", resource: providerID })
```

The provider catalog consults it while assembling visible providers. Every other surface reads the catalog instead of re-deriving availability, which removes four of the five copies outright. The TUI toggle writes a policy statement rather than splicing an array.

## Migration

1. Land `Policy` with an empty default and no consumers. Behavior unchanged.
2. Translate `disabled_providers` / `enabled_providers` into statements at config load, so old configs keep working with no edit. Deprecate the fields in the schema description; do not remove them.
3. Move `provider.ts` onto `Policy.allows`.
4. Move the four remaining call sites onto the catalog.
5. Change the TUI toggle to author a statement.
6. Only after those land, consider `plugin.load` and `mcp.connect`.

Steps 1–2 are inert. Step 3 is the behavior-carrying one and is where the precedence change (last match wins) becomes observable for a config that sets both fields — today that combination means "allowlist first, then denylist", and translation must preserve exactly that by emitting the deny statements after the allow statements.
