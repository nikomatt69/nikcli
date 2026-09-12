/**
 * The shapes command modules are written against, now that yargs is gone.
 *
 * Every `builder` in `src/cli/cmd/**` is still the declaration of what a command
 * accepts — `script/generate-cli.ts` runs them against a recording proxy to build
 * the `effect/unstable/cli` tree, and both parity tests run them again to check
 * that tree. Nothing calls them with a real yargs instance any more, so the types
 * only have to describe "a chainable declaration object".
 *
 * `Argv` is deliberately permissive. A faithful re-declaration of yargs' builder
 * surface would be hundreds of lines describing an API we no longer use, and the
 * only consumer is a `Proxy` that answers every method. Narrowing it would buy
 * nothing and cost every future builder a missing-method error.
 *
 * See `specs/cli-framework.md`.
 */
export interface Argv<_T = {}> {
  /**
   * Declared explicitly, unlike everything else, because it is the one method
   * that takes callbacks: without a signature the index signature below widens
   * `(yargs) => …` and `(args) => …` to `any` and every nested builder becomes
   * an implicit-any error.
   */
  command(module: CommandModule<any, any>): Argv<_T>
  command<Args>(
    name: string,
    describe: string,
    builder: (argv: Argv) => unknown,
    handler: (args: ArgumentsCamelCase<Args>) => unknown,
  ): Argv<_T>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [method: string]: (...args: any[]) => Argv<_T>
}

/** What yargs passed a handler: the parsed flags, plus its two reserved keys. */
export type ArgumentsCamelCase<T = {}> = T & {
  readonly _?: Array<string | number>
  readonly $0?: string
  readonly ["--"]?: string[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

/**
 * A command module.
 *
 * `builder` is the declaration the generator reads; `handler` is the body, which
 * the generated `cli/handlers/**` reach through `framework/command-bridge.ts`.
 */
export interface CommandModule<_T = {}, U = {}> {
  readonly command: string
  readonly describe?: string
  readonly aliases?: string | ReadonlyArray<string>
  readonly builder?: ((argv: Argv) => unknown) | Record<string, unknown>
  readonly handler: (args: ArgumentsCamelCase<U>) => unknown
}
