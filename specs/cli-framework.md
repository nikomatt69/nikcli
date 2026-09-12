# CLI framework: yargs → effect/unstable/cli

## Why

`cli-main.ts` must import `TuiThreadCommand` eagerly, because yargs needs the
default command's module to build its parser. That module *is* the TUI, so every
invocation — `nikcli --help`, `nikcli heap`, a shell completion — evaluates it.

opencode v2 does not have this problem. Its command tree is a dependency-free
spec (`commands/commands.ts`), every handler is a `() => import()` including the
default one, and the framework that binds them is 173 lines
(`framework/spec.ts` + `framework/runtime.ts`).

Measured on the same machine, importing each entrypoint — **both carrying the
complete command surface**:

| entrypoint | Function | FunctionExecutable | eval | total RSS |
| --- | ---: | ---: | ---: | ---: |
| `cli-main` (yargs, lazy handlers) | 154,001 | 13,449 | 875 ms | 116.0 MB |
| `cli/main-effect` (147 commands) | **25,252** | **9,519** | **171 ms** | **91.1 MB** |

−84% `Function` objects, −25 MB, −80% eval. The gap is `thread.ts`: yargs must
load the default command's module to build its parser, and that module is the
TUI. Effect never loads it for `--help`, for another command, or for a completion.

Declaring the other 143 commands cost **+2,010 `Function` objects** over the
first four-command slice — specs are `Flag` and `Argument` declarations, and they
are nearly free. What was expensive was never the command table; it was the
implementations hanging off it.

## What exists

The whole command surface is declared in the effect tree: **147 commands
(46 top level, the rest nested) and 254 parameters**, generated from the yargs
declarations and held to them by the parity harness.

- `src/cli/framework/spec.ts` — `Spec.make(name, {description, params, commands,
  aliases})` builds the tree as data. Ported from opencode, including the detail
  that effect carries one native alias and the rest become sibling commands:
  yargs allowed a list, and 36 aliases are in use.
- `src/cli/framework/runtime.ts` — `Runtime.handlers(tree, loaders)` flattens the
  loader tree; `Runtime.run` attaches `Command.withHandler` that imports on call.
  nikcli's handlers are plain async functions, so the runtime awaits them.
- `src/cli/framework/yargs-bridge.ts` — calls a yargs handler from an effect one.
  Leaves export their handler; a subcommand's lives inside the parent's `builder`
  closure and is reached by replaying that builder against a recorder.
- `src/cli/commands.ts`, `src/cli/handlers/**`, `src/cli/handlers.generated.ts` —
  **generated** by `script/generate-cli.ts`. That script runs every yargs builder
  against a recording proxy and renders the result; regenerate after changing a
  command, then run the parity test.
- `src/cli/main-effect.ts` — the second entrypoint, selected by `NIKCLI_CLI=effect`.

Effect owns parsing, help, routing and completion. The ~12,900 lines of command
bodies stay where they are and run through the bridge, so parsing and
implementation move in separate steps — otherwise the parity harness would be
comparing a rewrite against the original instead of comparing two parsers.

Verified by running it: 45 subcommands in `--help`; a leaf (`heap`); a group
member (`service status`); and a nested multi-word path (`mobile token list`,
which yargs declares as the single string `"token list"`). Required positionals
render usage rather than a stack trace, and exit codes are 0 / 1 / 1 for success,
a missing argument and an unknown command.

### Two yargs shapes the generator has to understand

Both were found by the generated output failing, not by reading the code:

- **`.command(name, describe, builder, handler)`**, the positional form, used by
  `analytics`. A recorder that only handles the module form silently drops those
  subcommands.
- **A command string that is a whole path.** `"token revoke <id>"` declares
  `token` then `revoke`. Three exist (`mobile token list|revoke`,
  `sync token create`), and collapsing them to their first word merges siblings
  into one name — which surfaced as a duplicate-identifier type error, and would
  otherwise have been two commands quietly becoming one.

## Migration surface, measured

57 files, ~12,900 lines: **166 `.option()`, 62 `.positional()`, 101 subcommand
registrations** — about 330 declarations.

What is *in* those declarations matters more than the count: `choices:` 13,
`array:` 7, `demandOption` 29, `default:` 88, `alias:` 36, `count:` 6, and
**zero** `coerce`, `conflicts`, `implies`, `check`, `strict` or `--` handling.
No custom validators, no cross-flag constraints. `Flag.choice`, `withDefault`,
`withAlias`, `optional`, `Argument.variadic` and `atLeast/atMost/between` cover
all of it except one gap.

## Known differences to handle

- **No counting flag.** The 6 `count:` options need a fold; effect has no
  equivalent primitive.
- **Optionals are `Option<T>`, not `T | undefined`.** Every handler bridges with
  `Option.getOrUndefined`. This is the easiest thing in the whole migration to
  get wrong quietly: a `as never` cast on the handler input hides it, which is
  exactly what happened in the first draft of `handlers/api.ts`.
- **camelCase/kebab-case.** yargs populates `args` under both spellings and
  synthesises `--no-x` for booleans. Handlers read `args.printLogs`; each read
  has to be checked, not translated by eye.
- **Repeated vs comma-split arrays.** The two libraries disagree on `array:`;
  the 7 sites need deciding individually.
- **Global middleware.** `cli-main`'s middleware (`initialize()`, the env flags,
  `Diagnostics.listen()`) maps onto global flags plus a wrapper around `run`.

## Parity harnesses

Two, because they catch different things — and the second one is the reason the
first is not enough.

**`test/cli/effect-cli-parity.test.ts` — declarations.** Walks the whole effect
tree and compares every command against the yargs command at the same path:
names, aliases, kind, optionality. 150 assertions, plus a check that no yargs
command is missing and that the tree is not trivially empty. Validated by
breaking it on purpose (removing `-s` from the default command's `--session`).

**`test/cli/effect-cli-parse-parity.test.ts` — parsed values.** Parses the same
argv with both and compares what the handler would receive: 304 vectors, one per
command plus one per flag, with sample values taken from each parameter's own
declared type and choices.

It earned its place immediately. `remote start` and `mobile serve` override
`--hostname` to `0.0.0.0` through yargs' `.default()` **method**, which the
generator's recorder ignored — so the generated spec bound loopback instead. The
declaration harness passed 150/150 the whole time, because the flag is *declared*
identically. Only the parsed value differed.

### A pre-existing bug it surfaced

`--no-tunnel` (`remote start`), `--no-chart` (`usage`) and `--no-auto-detect`
(`locale`) are declared as flags literally named `no-…`. yargs reserves that
prefix for boolean negation, so `--no-tunnel` sets `tunnel: false` and leaves
`no-tunnel` at its default. `remote start`'s handler reads `!args.noTunnel`,
which stays `false` — **the flag does nothing today**. Verified directly against
yargs, not inferred.

Effect has no such rule and sets the flag, so it behaves the way the flag is
documented. The parse harness excludes `no-`-prefixed names with that reasoning
recorded at the exclusion, because the two parsers genuinely differ and effect is
the correct one. Fixing the yargs side is a behaviour change and belongs in its
own change.

### Why the yargs side never routes

The first version of the parse harness wrapped the top-level handler and let
yargs dispatch to subcommands. It did not wrap deeply enough: for nested
commands yargs ran the **real** handler, and `companion`'s opened browser tabs on
the machine running the suite. It now walks the builders itself to the leaf
module and registers that leaf alone, with its own handler, in a fresh parser —
there is nothing nested for yargs to dispatch into.

## Order of work

1. ~~Framework, spec tree, handlers, second entrypoint, parity harness.~~ Done —
   the effect CLI serves the full command surface.
2. Move the command bodies from `src/cli/cmd/**` into `src/cli/handlers/**`, a
   batch at a time, deleting each bridge call as its body arrives. The parity
   harness stays useful throughout: it compares declarations, which do not move.
3. Rewrite `command-surface.test.ts` and `lazy-commands.test.ts` against the spec
   tree. Both parse `cli-main.ts` with regexes today; against a tree of data they
   get simpler.
4. Flip `index.ts` to the effect entry, then delete `cli-main.ts`,
   `cli/cmd/lazy.ts`, `cli/framework/yargs-bridge.ts`, `script/generate-cli.ts`
   and the yargs dependency. At that point the generated files stop being
   generated and become the source.
