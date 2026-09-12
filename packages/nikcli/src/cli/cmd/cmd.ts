import type { ArgumentsCamelCase, CommandModule } from "yargs"

type WithDoubleDash<T> = T & { "--"?: string[] }

/**
 * A command's resource lifecycle, declared rather than hand-rolled.
 *
 * `specs/effect-tui/18-cli-command-architecture.md` requirement 1. `bootstrap`
 * runs before the handler and may install process globals; `teardown` runs in a
 * `finally` and releases what the command acquired.
 *
 * The point is the `finally`. Written by hand at each call site it is the thing
 * that gets forgotten on the error path, and a command that leaks its database
 * handle or its watcher only shows it as a process that will not exit.
 */
export interface Lifecycle<T> {
  /** Fatal on failure: the handler does not run. Must be idempotent so a subcommand can re-bootstrap. */
  bootstrap?: (args: ArgumentsCamelCase<T>) => Promise<void> | void
  /** Runs whether the handler returned or threw. Its own failure is reported, never masking the handler's. */
  teardown?: (args: ArgumentsCamelCase<T>) => Promise<void> | void
}

export function cmd<T, U>(
  input: CommandModule<T, WithDoubleDash<U>> & Lifecycle<WithDoubleDash<U>>,
): CommandModule<T, WithDoubleDash<U>> {
  const { bootstrap, teardown, ...rest } = input
  if (!bootstrap && !teardown) return rest

  const handler = input.handler
  return {
    ...rest,
    async handler(args) {
      await bootstrap?.(args)
      try {
        return await handler(args)
      } finally {
        // A teardown that throws must not replace the handler's outcome: the
        // handler's failure is the one the operator needs, and a cleanup error
        // reported in its place sends them after the wrong thing.
        try {
          await teardown?.(args)
        } catch (error) {
          const { Log } = await import("@nikcli-ai/util/log")
          Log.Default.error("command teardown failed", { command: String(rest.command), error })
        }
      }
    },
  }
}
