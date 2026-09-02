# CLI Command Surface

| Field  | Value                                                                   |
| ------ | ----------------------------------------------------------------------- |
| Status | **Proposed**                                                            |
| Scope  | `src/cli-main.ts`, `src/cli/cmd/*.ts`, `packages/util/src/cli-error.ts` |

The question this records: which `nikcli …` commands are actually registered, and what is shared across them.

The answer is **the yargs tree in `cli-main.ts`**. A file under `src/cli/cmd/` is not a command until it is `.command()`-registered there. Filename inference is not the contract.

## The Surface

Entry is `src/cli-main.ts` `runCli()`. Shared flags on the root parser: `--help`/`-h`, `--version`/`-v`, `--print-logs`, `--log-level`, `--island`, `--auto` (aliases `--yolo`, `--dangerously-skip-permissions`). `--auto` sets `NIKCLI_AUTO_APPROVE=1` for the worker that never sees argv.

Fatal errors go through `FormatError` (`packages/util/src/cli-error.ts`) and `process.exitCode = 1`. There is no documented 2/3/4 category table in that module.

The default command is the TUI: `TuiThreadCommand` is registered as `$0 [project]`.

## Registered Commands

Source: the `.command(...)` list in `src/cli-main.ts` plus `yargs.completion("completion", …)`. Subcommands are the nested `command:` strings in each file. This table is not a CI gate.

| Command           | Subcommands (as registered)                                                                        | Notes                                     |
| ----------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| _(default TUI)_   | `$0 [project]`                                                                                     | `src/cli/cmd/tui/thread.ts`               |
| `attach`          | `<url>`                                                                                            | Attach to an existing server              |
| `run`             | `[message..]`                                                                                      | One-shot prompt                           |
| `serve`           | —                                                                                                  | HTTP server                               |
| `workspace-serve` | —                                                                                                  | Standalone workspace host                 |
| `web`             | —                                                                                                  | Web UI                                    |
| `acp`             | —                                                                                                  | Agent Client Protocol                     |
| `mcp`             | `list`, `auth [name]`, `logout [name]`, `add`, `debug <name>`                                      |                                           |
| `auth`            | `list`, `login [url]`, `logout`                                                                    | Credentials                               |
| `account`         | `login`, `logout`, `list`, `switch`, `orgs`                                                        |                                           |
| `agent`           | `create`, `list`                                                                                   |                                           |
| `upgrade`         | `[target]`                                                                                         | Replaces the binary                       |
| `uninstall`       | —                                                                                                  |                                           |
| `doctor`          | —                                                                                                  | Diagnostic                                |
| `quickstart`      | —                                                                                                  |                                           |
| `models`          | `[provider]`                                                                                       |                                           |
| `image-model`     | `[provider] [model]`                                                                               |                                           |
| `speak-model`     | `[provider] [model]`                                                                               |                                           |
| `brain-model`     | `[model]`                                                                                          |                                           |
| `locale`          | `[action]`                                                                                         |                                           |
| `stats`           | —                                                                                                  |                                           |
| `usage`           | —                                                                                                  |                                           |
| `export`          | `[sessionID]`                                                                                      |                                           |
| `import`          | `<file>`                                                                                           | Persists through `SessionV2Write.persist` |
| `github`          | `install`, `run`                                                                                   |                                           |
| `pr`              | `<number>`                                                                                         |                                           |
| `session`         | `list`                                                                                             | No `show` / `delete` on this command      |
| `debug`           | `config`, `lsp`, `search`, `file`, `scrap`, `skill`, `snapshot`, `agent`, `paths`, `wait`          |                                           |
| `generate`        | —                                                                                                  | OpenAPI / codegen helper                  |
| `plugin`          | `<module>`                                                                                         | `src/cli/cmd/plug.ts`                     |
| `connectors`      | `list`, `auth [name]`, `logout [name]`, `add`                                                      |                                           |
| `sync`            | `status`, `connect`, `disconnect`, `token create`                                                  |                                           |
| `remote`          | `start`, `stop`, `status`, `share`, `attach <sessionId>`                                           |                                           |
| `teleport`        | `[sessionID]`                                                                                      |                                           |
| `companion`       | `serve`, `open`                                                                                    |                                           |
| `mobile`          | `serve`, `pair`, `token list`, `token revoke <id>`                                                 |                                           |
| `routine`         | `list`, `create`, `get <id>`, `run <id>`, `pause <id>`, `resume <id>`, `delete <id>`               |                                           |
| `mission`         | `list`, `new`, `get <id>`, `start <id>`, `pause <id>`, `resume <id>`, `cancel <id>`, `delete <id>` |                                           |
| `goal`            | `[condition..]`                                                                                    |                                           |
| `analytics`       | `<subcommand>`                                                                                     |                                           |
| `artifact`        | `login`, `logout`, `list [session-id]`                                                             |                                           |
| `ads`             | `create`, `list`, `remove [id]`, `toggle [id]`, `enable`, `disable`                                |                                           |
| `bot`             | `list`, `add`, `start [name]`, `stop [name]`, `webhook [name]`                                     | Chatbot                                   |
| `heap`            | —                                                                                                  |                                           |
| `completion`      | —                                                                                                  | yargs-generated shell completion          |

Not registered as top-level commands, despite files or earlier drafts: `config`, `db`, `tool`, `loop`. Loops are driven from the TUI / HTTP, not a `nikcli loop` command.

## User-visible install commands

`upgrade`, `uninstall`, `doctor`, and `run` are the ones a first-time user types. They must not fail silently. That is a product convention, not a separate exit-code enum.

## Shared conventions that are real

- Server-bootstrapping commands (`serve`, `run`, `web`, `workspace-serve`, `mcp`, `acp`, …) start the server in-process and stop it when the command exits.
- `--directory` is **not** a root flag in `cli-main.ts`. Directory binding is per-command / `bootstrap(process.cwd(), …)` where that command uses it. Do not document it as universal until the parser says so.
- `NIKCLI_AUTO_APPROVE` is the only cross-command permission skip, and denials still apply (`--auto` help text).

## What this document is not

It is not a CI check. Adding `src/cli/cmd/foo.ts` without registering it in `cli-main.ts` does not fail a job today. A `script/check-cli-table.ts` would be a ROADMAP leftover **after** this table matches the parser — it is not one yet, and inventing the script in AGENTS.md would be a lie.

## Alternatives Rejected

**Index by filename.** Rejected because `plug.ts` is `plugin`, `chatbot.ts` is `bot`, and several files are not commands at all (`tui/worker.ts`).

**Plugin-registered top-level commands.** Rejected: the CLI is bundled. `plugin` manages modules; modules do not add `nikcli <name>` entries.

## Invariants

- A command exists if and only if `cli-main.ts` (or the default `$0`) registers it.
- Fatal CLI failures set `process.exitCode = 1`.
- The default invocation with no subcommand is the TUI.

## What Is Explicitly Not Covered

- Per-command flag lists (read the file).
- Shell-completion generation internals.
- The mobile HTTP surface (not a CLI).
