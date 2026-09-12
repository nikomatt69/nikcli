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
- `src/cli/commands.ts` — the spec tree, and `src/cli/handlers.ts` — the loader
  tree. Both began as generated output and are now the source: edit them directly.
- `src/cli/handlers/**` — one file per command, holding that command's body. A
  module's helpers sit in a `shared.ts` beside the handlers that use them.
- `src/cli/global-flags.ts` — the flags every command accepts, plus `normalizeArgv`.
- `src/cli/main-effect.ts` — **the entrypoint**, including the bootstrap yargs ran
  in a root `.middleware()`.
- `src/cli/framework/args.ts` — the `--` passthrough the bodies expect.

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

Effect owns parsing, help, routing and completion, and **`src/cli/cmd/**` is
gone**: each handler holds the body it runs. What is left in that directory is
`cmd.ts` and `argv.ts` (the command-module types, still used by two modules under
`src/session/`) and `tui/worker.ts` plus `tui/plugin/host-local.ts`, which were
never commands.

Getting there needed every command object to be reachable as a named export, and
only 42 of 100 subcommands were. The rest were module-level consts missing the
`export` keyword (35, a one-word change each), objects defined inline inside a
parent's `builder` (11, hoisted to exported consts), or declared through
`.command(name, describe, builder, handler)` (2, in `analytics`, converted to
command objects). A subcommand is also frequently exported from a *sibling*
module — `debug/file.ts` under `debug/index.ts` — so the generator resolves
owners by indexing every exported command object in `src/cli/cmd/**` by identity,
not by looking only at the parent's module.

The bodies themselves did not move. They are still ~12,900 lines under
`cli/cmd/**`; what changed is that nothing discovers them at runtime any more.

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

## Four places effect and yargs disagree

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
tokens to their message. `framework/args.ts` reconstructs it from the real argv.

**Nothing exits on its own.** yargs' entrypoint ended in
`finally { process.exit() }` — "some subprocesses don't react properly to
SIGTERM… explicitly exit to avoid any hanging subprocesses". Ported without it,
`analytics show` printed its output and then hung forever on an open database
handle. `main-effect.ts` exits after the command returns, as opencode's
entrypoint does. Worth knowing because the symptom is not a failure: the command
works, it just never gives the shell back.

**Both spellings of every flag.** yargs filled `keep-config` *and* `keepConfig`,
and the bodies read whichever the author preferred — `uninstall`'s args type
requires the camelCase ones. Generated handlers emit both.

## Order of work

1. ~~Framework, spec tree, handlers, parity harnesses.~~ Done.
2. ~~Global flags, bootstrap, entrypoint flip.~~ Done.
3. ~~Delete `cli-main.ts`, `cli/cmd/lazy.ts` and the yargs dependency.~~ Done.
4. ~~Remove the bridge: every handler imports its body directly.~~ Done.
5. ~~Move the bodies into the handlers and delete `cli/cmd/**`.~~ Done.

The generator, `registry.ts` and both parity harnesses are deleted with it: they
compared the effect tree against yargs declarations, and there are none left to
compare against. That scaffolding was only ever correct while both systems stood.

### What the move cost

Three couplings had to be cut first, because `cli/cmd/**` was not a leaf
directory: `server/httpapi/doctor.ts` borrowed `runDoctorChecks` (now
`src/doctor/checks.ts`, its own module), `goal` called `RunCommand.handler` (now
`runWithArgs`, exported from `handlers/run.ts`), and two dead modules under
`src/session/` still import `cmd()`.

Two parameters were found missing from the generated tree: `remote attach
<sessionId>` and `remote [command]` declare their positionals **only in the yargs
command string**, never through `.positional()`, so the generator — which read
`.positional()` calls — never saw them. They are declared in `commands.ts` now.

Two behaviours were preserved deliberately rather than inherited by accident:
`locale` reads `args["auto-detect"]`, which only existed because yargs' negation
rule turned `--no-auto-detect` into it, so the handler derives it; and `--models`
had no yargs `type`, so a bare flag arrived as `true` — effect declares it a
string, so "all models" is now any non-numeric value.
