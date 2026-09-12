import type { Argv, CommandModule } from "yargs"

/**
 * A command whose implementation module is imported only when it actually runs.
 *
 * Every command used to be a static import in `cli-main.ts`, so the module
 * graph of all 45 of them was evaluated before yargs had even looked at argv.
 * That is why `nikcli --version` cost the same ~409MB peak RSS as `nikcli
 * serve`: the price is closure allocation at module-evaluation time (~1.05M
 * `Function` objects across the full graph, ~330 bytes of RSS each), and it is
 * retained, not transient — a forced `Bun.gc(true)` gives none of it back.
 *
 * yargs only needs `command`, `describe` and `aliases` to route argv and to
 * render the top-level help listing; it calls `builder` for the matched command
 * alone. So the metadata stays static here and the module load moves behind
 * `builder`/`handler`, which yargs has awaited since v17.
 *
 * The load survives `bun build --compile`: a dynamic `import()` inside a
 * standalone binary really does defer evaluation rather than being inlined into
 * the entry chunk (measured: 117.5MB eager vs 23.1MB lazy on the cheap path,
 * with identical binary size).
 *
 * The cost of the split is that `command`/`describe`/`aliases` are written
 * twice — once here, once in the implementation module — and could drift.
 * `test/cli/lazy-commands.test.ts` loads every implementation and asserts the
 * two agree, so drift fails CI instead of silently producing wrong help text.
 */
export interface LazyCommandMeta {
  /** Must equal the implementation module's `command`, positionals included. */
  command: string
  /** Must equal the implementation module's `describe`. `undefined` when it has none. */
  describe?: string
  /** Must equal the implementation module's `aliases`. */
  aliases?: readonly string[]
}

/**
 * A command module as loaded from disk — deliberately looser than yargs' own
 * `CommandModule`.
 *
 * Several commands type their handler against their own options interface
 * (`UninstallArgs`, upgrade's `{ target?, method? }`, …). `CommandModule<any,
 * any>` rejects those under `strictFunctionTypes`, because its handler
 * parameter is the concrete `ArgumentsCamelCase<any>` and parameters are
 * checked contravariantly. Widening the parameter to `any` is what makes them
 * assignable, and it gives up nothing here: this indirection only forwards
 * argv, while each implementation keeps its precise types internally and yargs
 * validates the actual arguments at runtime.
 */
export type LoadedCommand = Omit<CommandModule<any, any>, "handler"> & {
  handler: (args: any) => void | Promise<void>
}

export function lazyCmd(meta: LazyCommandMeta, load: () => Promise<LoadedCommand>): CommandModule<any, any> {
  // Memoized so `builder` and `handler` — both of which need the module, and
  // both of which yargs calls for a matched command — share one evaluation.
  // `import()` caches too; this just avoids depending on that for correctness.
  let pending: Promise<LoadedCommand> | undefined
  const resolve = () => (pending ??= load())

  const command: CommandModule<any, any> = {
    command: meta.command,
    builder: async (yargs: Argv) => {
      const loaded = await resolve()
      // yargs declares `builder` as a function *or* a map of option
      // definitions, and `typeof` is the only thing that separates them —
      // there is no domain value to branch on. Both shapes are handled so the
      // indirection stays faithful to what yargs itself accepts; `generate` has
      // no builder at all.
      if (typeof loaded.builder === "function") return loaded.builder(yargs)
      if (loaded.builder) return yargs.options(loaded.builder)
      return yargs
    },
    handler: async (args: any) => {
      const loaded = await resolve()
      return loaded.handler(args)
    },
  }
  // Assigned only when present: yargs distinguishes a command with no help text
  // from one described as `undefined`, and `generate` is the former.
  if (meta.describe !== undefined) command.describe = meta.describe
  if (meta.aliases !== undefined) command.aliases = [...meta.aliases]
  return command
}
