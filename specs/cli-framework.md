# CLI framework: yargs → effect/unstable/cli

## Why

`cli-main.ts` must import `TuiThreadCommand` eagerly, because yargs needs the
default command's module to build its parser. That module *is* the TUI, so every
invocation — `nikcli --help`, `nikcli heap`, a shell completion — evaluates it.

opencode v2 does not have this problem. Its command tree is a dependency-free
spec (`commands/commands.ts`), every handler is a `() => import()` including the
default one, and the framework that binds them is 173 lines
(`framework/spec.ts` + `framework/runtime.ts`).

Measured on the same machine, importing each entrypoint, both carrying the
complete command surface:

| entrypoint | Function | FunctionExecutable | total RSS |
| --- | ---: | ---: | ---: |
| `cli-main` (yargs, lazy handlers) | 154,001 | 13,449 | 116.0 MB |
| `cli/main-effect` | **33,014** | **10,571** | **~90 MB** |

−79% `Function` objects. The gap is `thread.ts`: yargs had to load the default
command's module to build its parser, and that module is the TUI. Effect never
loads it for `--help`, for another command, or for a completion.

Declaring all 147 commands costs about 2,000 `Function` objects over a
four-command slice — specs are `Flag` and `Argument` declarations and are nearly
free. What was expensive was never the command table; it was the implementations
hanging off it.

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
- `src/cli/global-flags.ts` — the flags every command accepts, plus `normalizeArgv`.
- `src/cli/registry.ts` — every command module, as data. The list used to be
  implicit in `cli-main.ts`'s chain of `.command(...)` calls, which the generator
  and both parity tests had to parse with regexes.
- `src/cli/main-effect.ts` — **the entrypoint**, including the bootstrap yargs ran
  in a root `.middleware()`.
- `src/cli/framework/command-bridge.ts` — calls a command's body from its
  generated handler.

**yargs is gone.** `cli-main.ts`, `cli/cmd/lazy.ts` and the dependency are
deleted; it survives in `node_modules` only as a transitive dependency of
unrelated packages (metro, qrcode, localtunnel). The modules under `cli/cmd/**`
keep the `{command, builder, handler}` shape — `builder` is now purely the
declaration the generator reads — and type against `cli/cmd/argv.ts` instead of
`@types/yargs`.

That shim is deliberately permissive: the only thing that ever calls a builder is
a recording `Proxy` that answers every method, so re-declaring yargs' real
surface would be hundreds of lines describing an API nothing uses. `command` is
the one method declared explicitly, because it takes callbacks and the index
signature would otherwise widen every nested builder to `any`. Three sites needed
a type annotation that yargs used to infer from its builder chain
(`analytics`'s two range handlers, one `split` callback in `agent`).

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

## Three places effect and yargs disagree

Each was found by running the CLI, and each is handled explicitly rather than
papered over.

**The root cannot own a positional.** yargs special-cases its default command, so
`nikcli [project]` and `nikcli heap --detailed` both work. Effect has no such
rule: an optional positional on a command that also has subcommands swallows the
subcommand name as soon as a flag follows, and *every* `nikcli <cmd> --flag`
routes to the root handler — the TUI — instead. The generator therefore emits the
root's positionals as flags, and `normalizeArgv` rewrites a leading path back
into `--project`, so the spelling users type is unchanged. The declaration parity
test encodes this exception with its reason.

**`--log-level` is effect's, not ours.** It ships as a built-in global flag;
declaring a second one is a hard `Duplicate flag name` error at startup. Its
choices are lower-case where nikcli has always taken `DEBUG`, so `normalizeArgv`
folds the value before the parser sees it.

**`--` is not populated.** yargs did it via
`parserConfiguration({"populate--": true})`, and `run` and `goal` append those
tokens to their message. The bridge reconstructs it from the real argv in one
place rather than in each generated handler.

## Order of work

1. ~~Framework, spec tree, handlers, parity harnesses.~~ Done.
2. ~~Global flags, bootstrap, entrypoint flip.~~ Done.
3. ~~Delete `cli-main.ts`, `cli/cmd/lazy.ts` and the yargs dependency.~~ Done.
4. Move the command bodies from `src/cli/cmd/**` into `src/cli/handlers/**`, a
   batch at a time, deleting each `delegate()` call as its body arrives, and with
   it the need for `command-bridge.ts` and `script/generate-cli.ts`. The parity
   harnesses stay useful throughout: they compare declarations and parsed values,
   neither of which moves.

   The blocker is not the leaves — 27 top-level commands export their handler and
   move mechanically. It is the 19 groups: their subcommand handlers are closures
   inside the parent's `builder`, capturing module scope, which is why the bridge
   reaches them by replaying that builder rather than importing them. Each group
   has to be restructured so its subcommands are real exports; that is per-file
   work, not a transform.
