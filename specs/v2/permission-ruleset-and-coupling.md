# Permission Ruleset & Coupling

| Field  | Value                                                                                     |
| ------ | ----------------------------------------------------------------------------------------- |
| Status | **Proposed**                                                                              |
| Scope  | `src/permission/next.ts`, `src/permission/ruleset.ts`, `src/server/httpapi/permission.ts` |
| Tests  | `test/tool/permission-surface.test.ts`                                                    |

The question this records: when a tool asks for permission, what string the ruleset is evaluated against, how rulesets combine, and what a reply actually persists.

The answer is **a small explicit tool→permission map, last-match-wins evaluation, and a project-scoped approved list**. A deny on the mapped family covers the tools; a deny on a tool id that is not the family does not cover the family. Unlisted tools evaluate against their own id.

## The Surface

`PermissionRuleset` in `src/permission/ruleset.ts` is the pure model: `Action` (`allow` | `deny` | `ask`), `Rule` (`permission`, `pattern`, `action`), `Ruleset` (mutable array of rules). `PermissionNext` in `src/permission/next.ts` is the stateful service: `ask`, `reply`, hydrate, list. HTTP is `src/server/httpapi/permission.ts`.

`PermissionNext.ask` takes `{ permission, patterns, ruleset, sessionID, … }`. For each pattern it calls `evaluate(permission, pattern, ruleset, approved)`:

- `deny` → `DeniedError`
- `ask` → park on a pending map, publish `permission.asked`, wait for `reply` (unless `NIKCLI_DANGEROUSLY_SKIP_PERMISSIONS`, which skips `ask` after the deny check)
- `allow` → continue

Miss (no matching rule) is `{ action: "ask", permission, pattern: "*" }`.

## The Coupling Map

`PermissionRuleset.TOOL_PERMISSION` is the only compile-time remapping. Tools not listed evaluate against their own id (`tool === permission`). That default is deliberate — a new tool does not fail to register, and it does not inherit a hidden family.

| Tool id       | Permission evaluated | Why                                                       |
| ------------- | -------------------- | --------------------------------------------------------- |
| `monitor`     | `bash`               | Async shell subscription; a deny on `bash` must cover it. |
| `edit`        | `edit`               | Identity; listed so the family is visible in one table.   |
| `write`       | `edit`               | Full-file write.                                          |
| `patch`       | `edit`               | GPT-style apply_patch sibling.                            |
| `multiedit`   | `edit`               | Multi-hunk string replace.                                |
| `apply_patch` | `edit`               | Same family as `patch`.                                   |

`disabled(tools, ruleset)` uses that map, then `findLast` on the **permission** (not the tool id), and only counts a hit when `pattern === "*"` and `action === "deny"`. A deny on `monitor` therefore does **not** disable `bash`. A deny on `bash` with pattern `*` disables `monitor`. That is the asymmetry documented in `packages/nikcli/AGENTS.md`.

## How Rulesets Combine

`merge(...rulesets)` is concatenation. `evaluate` walks the merged array with `findLast` where both `permission` and `pattern` wildcard-match. Later rules win. There is no “session beats agent” operator.

What `ask` actually merges:

1. The caller-supplied `ruleset` (agent config plus any session overlay the prompt layer already folded in — `session/prompt.ts` `permissions()` turns `input.tools` into allow/deny rules).
2. `s.approved` — the project’s persisted approvals from `PermissionRepo.get(project.id)`.

Session-vs-agent precedence, if it exists, is in how the caller builds `input.ruleset`, not in `evaluate`.

`fromConfig` expands a `Config.Permission` object into rules (`key` → permission, string value → `pattern: "*"`, nested map → per-pattern). `fullAccess()` is `* / * allow` then deny `question`, `plan_enter`, `plan_exit`. `autoApprove` keeps only still-effective denials after a blanket allow.

## The Ask / Reply Contract

`reply` accepts `{ requestID, reply: "once" | "always" | "reject", message? }`. Unknown request ids are no-ops.

- **`once`** — resolve that pending ask. Nothing persisted.
- **`always`** — append `{ permission, pattern, action: "allow" }` for each entry in the request’s `always` list, `PermissionRepo.upsert` the project’s approved ruleset, resolve this ask, and resolve any other pending ask on the **same session** that now evaluates to allow.
- **`reject`** — reject this ask (`RejectedError`, or `CorrectedError` if `message` is set) and reject every other pending ask on the same session.

Approved rules are **per project**, not per session, and not keyed by a rule hash. There is no `PermissionNext.revoke`. Clearing an always-allow is editing the stored ruleset (TUI / config), not a reply.

`reply` publishes `permission.replied` and resumes the parked callback. It is not a typed HTTP success body. The HTTP route is a POST that drives this service.

## Alternatives Rejected

**Treat a tool deny as a family deny.** Silent over-reach. `disabled()` only lifts `pattern === "*"` family denies onto mapped tools.

**Fail registration when a tool has no family.** The historical default (`tool === permission`) is what most tools want. The table is the exception list.

**A typed `reply` return.** The parked `ask` is an Effect callback resumed from another request. The bus event is the cross-request signal; the callback is the waiter.

## Invariants

- `TOOL_PERMISSION` is the only remapping. Unlisted tool id = permission id.
- `evaluate` is last-match-wins over concatenated rulesets. Miss is `ask`.
- Family deny with `pattern: "*"` covers every tool mapped to that family. A deny on a mapped tool id does not cover the family.
- `always` persists allow rules on the **project** approved list. `once` persists nothing. `reject` cancels the session’s pending asks.
- Built-in tools call `PermissionNext.ask` in-process. Plugin tools reach it through whatever the plugin host wired — the registry does not give them a second client.

## What Is Explicitly Not Covered

- How a particular agent config is folded into `AskInput.ruleset` (prompt layer).
- Pattern language beyond `Wildcard.match` (glob-style, including `~` / `$HOME` expansion in `fromConfig`).
- HTTP wire of `permissionRespond` (see [mobile companion](./mobile-companion-protocol.md) for the mobile literal).
