import type { Argv, CommandModule } from "yargs"

/**
 * A command whose spec is static and whose implementation is loaded on first use.
 *
 * Registering all ~44 commands eagerly costs **988K `Function` objects and
 * ~364MB RSS**, against **153K and ~124MB** for the TUI path on its own — the
 * command table is roughly 240MB of the client, for implementations that all but
 * one invocation never calls.
 *
 * An earlier attempt (commit `1e6e0ce304`) deferred command modules and was
 * reverted: it made the tool worse to use. The lesson was not that laziness is
 * wrong but *where* the cost lands — deferral relocates work into the moment of
 * use, and in a monolith where every command drags the whole engine, the moment
 * of use is the user's keystroke. Two things changed:
 *
 * - The interactive path stays eager. Only commands whose first use is already
 *   an expensive, non-interactive operation are deferred.
 * - With the background service (`specs/background-service.md`) a handler is a
 *   thin HTTP client, so what gets deferred is small in the first place.
 *
 * `describe` and `command` stay here, in the caller, so `nikcli --help`, command
 * matching and shell completion never load a handler. yargs awaits an async
 * `builder`, so per-command flags still parse exactly as before — the module is
 * loaded before the flags it declares are needed. `test/cli/lazy-commands.test.ts`
 * asserts each spec still matches the module it points at.
 */
export interface LazySpec {
  /** Must equal the target module's own `command`. */
  readonly command: string
  /** Must equal the target module's own `describe`. */
  readonly describe: string
  readonly aliases?: string | ReadonlyArray<string>
}

export function lazy(spec: LazySpec, load: () => Promise<CommandModule<any, any>>): CommandModule<any, any> {
  let cached: Promise<CommandModule<any, any>> | undefined
  const target = () => (cached ??= load())

  return {
    command: spec.command,
    describe: spec.describe,
    ...(spec.aliases ? { aliases: spec.aliases as string | string[] } : {}),
    builder: async (yargs: Argv) => {
      const module = await target()
      const builder = module.builder
      if (typeof builder === "function") return builder(yargs)
      if (builder) return yargs.options(builder)
      return yargs
    },
    handler: async (args: any) => {
      const module = await target()
      return module.handler(args)
    },
  }
}

/** Pull a named export out of a module, for `lazy(spec, exported(() => import("..."), "FooCommand"))`. */
export function exported<M extends Record<string, unknown>>(
  load: () => Promise<M>,
  name: keyof M & string,
): () => Promise<CommandModule<any, any>> {
  return async () => {
    const module = await load()
    return module[name] as CommandModule<any, any>
  }
}
