# EOT-18: CLI Command Architecture and Dispatch

Status: proposed. Tier: 2. Phase: P3. Dependencies: EOT-02, EOT-08.
Owner: `packages/nikcli/src/cli/cmd/*` and `packages/nikcli/src/cli/effect/*` maintainers. [Roadmap](../ROADMAP.md).

## Problem and Evidence

Evidence B34, B35 in the [register](../README.md): `packages/nikcli/src/cli-main.ts` registers 45+ commands through yargs
(account, acp, ads, agent, analytics, api, artifact, auth, brain-model, chatbot, companion, connectors, debug, doctor,
export, generate, github, goal, heap, image-model, import, locale, mcp, mission, mobile, models, plug, pr, quickstart,
remote, routine, run, serve, session, speak-model, stats, sync, teleport, tui, uninstall, upgrade, usage, web,
workspace-serve). Each command is a `yargs` `CommandModule`; subcommands are nested under `cmd/debug/` and `cmd/tui/`.
`cli/effect/prompt.ts` wraps `@clack/prompts` in Effect. The registered set is
already gated: [`specs/cli-command-surface.md`](../cli-command-surface.md) is the inventory and
`test/cli/command-surface.test.ts` fails if a command is added or removed without updating it. The opportunity is a single architectural spec covering
command routing, plugin command registration, daemon/attach coordination, and the dispatch lifecycle (parse → bootstrap
→ service → teardown). Right now each command is an independent module with no shared command lifecycle spec.

## Scope and Non-Goals

Define the canonical CLI command architecture: command shape, dispatch lifecycle, bootstrap/teardown, plugin command
registration, and the typed boundary between yargs and the application services. Preserve the existing yargs binding and
the existing 45+ commands. Do not invent a second parser, replace yargs, change the on-disk layout, or break existing
command flags.

## Design and Requirements

1. A command is a typed module: `{ name, description, builder, handler, bootstrap?, teardown? }`. `builder` returns the
   yargs definition; `handler` is a typed Effect that yields the parsed args and the bootstrap context. `bootstrap?` runs
   before `handler` and may install global state (e.g. install the plugin installer). `teardown?` runs in `finally` and
   releases resources.
2. The dispatcher is one Effect module: it parses args via yargs, resolves the command, runs `bootstrap`, then runs the
   `handler` Effect with the runtime layer, then runs `teardown`. The dispatcher catches `Exit` causes (defect,
   interruption, failure) and surfaces them through the existing `FormatError` and `Log` sinks.
3. Bootstrap is the standard pre-handler step: install globals, set up logging, initialize the plugin installer, open the
   database connection, and prepare the runtime layer. Bootstrap failures are fatal: the command does not run. Bootstrap
   is idempotent within a process so subcommands can re-bootstrap safely (e.g. debug/wait).
4. The runtime layer is built once per command invocation, not per service. Service composition is shared with the TUI
   where possible; commands that need only a subset of services get the minimum required layer. Layer memoization keeps
   build cost down.
5. Plugin commands are registered through the plugin runtime (EOT-14). The CLI dispatcher exposes the registered
   commands under their plugin scope (`<plugin-id>:<command>`); conflicts with built-in commands resolve through the
   plugin's `priority` field, never by silent registration order.
6. Daemon/attach coordination is a typed lifecycle:
   - `nikcli serve` and `nikcli workspace-serve` start a long-running server with the HTTP/mDNS/mobile transports.
   - `nikcli run` and `nikcli session` connect to an existing server, fall back to spawning one if none is reachable.
   - `nikcli attach` is a typed attach to an existing browser daemon.
     The dispatcher exposes these as typed operations; the on-disk state (PID files, sockets) is owned by the
     `InstanceState` module, not by individual commands.
7. Network and configuration flags are resolved once per command, before the handler runs. The `withNetworkOptions`
   helper is the canonical resolver; commands that need different network semantics declare their own opt-in resolver.
8. Output formatting is a typed boundary: commands return either a typed Effect result or a JSON-serializable value.
   `UI.spinner`, `UI.text`, and `UI.log` are the canonical writers; raw `console.log` is forbidden in handlers. The
   `clack/prompts` integration goes through `cli/effect/prompt.ts`; prompts in non-TTY environments fall back to
   non-interactive defaults that fail closed.
9. Errors flow through `FormatError` and `Log`, with redacted sinks. Stack traces honor `NIKCLI_DEBUG`. Exit codes
   follow the documented mapping: `0` success, `1` generic failure, `2` invalid usage, `64` config error, `66` no input,
   `69` service unavailable, `130` interrupted (matches SIGINT convention). The mapping is typed and consistent across
   commands.
10. Long-running commands (`serve`, `run --watch`, `mobile connect`) coordinate shutdown via `Effect.scoped` plus a
    shutdown signal handler. The handler catches `SIGINT`/`SIGTERM`, signals the scope to close, and runs finalizers
    with a deadline. Commands that ignore the shutdown signal are defects.
11. Subcommands under `cmd/debug/` and `cmd/tui/` follow the same shape as top-level commands; the dispatcher recurses
    through nested `builder` declarations. There is no special-cased path for subcommands.
12. Headless mode: a `NIKCLI_HEADLESS=1` flag disables interactive prompts. The handler that needs a prompt falls back
    to its documented non-interactive default; the runtime fails closed for prompts that have no default. Headless mode
    never silently picks "yes".

## Command Topology

```text
yargs parse
  -> Command resolver
  -> bootstrap (install globals, log, db, runtime layer)
  -> handler (typed Effect)
       -> Effect.gen over services
       -> teardown (release resources, close db, signal daemon)
  -> exit code (typed mapping)
```

## Failure and Cancellation

Use `Schema.TaggedError`: `CommandError.UnknownCommand`, `CommandError.BootstrapFailed`, `CommandError.InvalidArgs`,
`CommandError.PermissionDenied`, `CommandError.HeadlessFailure`, `CommandError.ShutdownTimeout`. Cancellation through
SIGINT/SIGTERM closes the command scope; partial work is reported with the documented exit code. Bootstrap failures
prevent `handler` from running; the command exits with a typed failure and a redacted log. A headless failure exits with
a non-zero code and a typed message; it never silently continues.

## Acceptance and Verification

- All 45+ commands dispatch through the new architecture; command shape is consistent; bootstrap/teardown are exercised
  on at least one example from each top-level group (`run`, `serve`, `auth`, `plugin`, `mobile`, `debug`).
- Daemon lifecycle: `serve` starts, `mobile connect` attaches, shutdown via SIGINT exits cleanly within the deadline,
  PID/socket state is cleaned up, and a second `serve` reuses or restarts as documented.
- Plugin commands appear under `<plugin-id>:<command>`; conflicts resolve by documented priority, not by registration
  order; an unloaded plugin's command is no longer dispatched.
- Headless mode: a prompt with no default fails closed; the documented exit code is set; the error is typed and
  redacted.
- Exit codes follow the documented mapping; stack traces honor `NIKCLI_DEBUG`; `FormatError` covers all reported
  failures.
- Extend `packages/nikcli/test/cli/cmd/`, `packages/nikcli/test/cli/`, `packages/nikcli/test/plugin/`, and the existing
  command tests.
- From `packages/nikcli`: `bun test test/cli/`. One final root `bun run typecheck` after the slice.
- Meet EOT-01 budgets; command dispatch overhead below 50 ms p95 on the warm fixture; bootstrap shared with the TUI
  avoids duplicate work.

## Migration and Rollback

Migrate commands in groups: top-level lifecycle (`run`, `serve`, `session`), then identity (`auth`, `account`), then
plugin (`plug`), then the rest. Each migration PR flips a single command; legacy commands continue to dispatch. Roll
back by flipping the command's handler back to the legacy module; the dispatcher shape stays. Bootstrap changes are
additive; never delete a previously-installed global or DB connection as part of a dispatch refactor.
