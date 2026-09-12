import type { Argv } from "yargs"

/**
 * Calls a yargs command's handler from an `effect/unstable/cli` handler.
 *
 * The command *tree* has moved to `cli/commands.ts`; the ~12,900 lines of
 * command bodies have not, and moving parsing and implementation in one step
 * would mean the parity harness compares a rewrite against the original instead
 * of comparing two parsers. So during the migration effect owns parsing, help
 * and routing, and the body runs where it already lives.
 *
 * A leaf command exports its handler, so it can be called directly. A
 * subcommand's cannot: yargs groups build their children inside the parent's
 * `builder` closure, and nothing is exported. Replaying that builder against a
 * recorder is what reaches them — the same technique the parity harness uses to
 * read yargs declarations, here used to reach the functions themselves.
 *
 * See `specs/cli-framework.md`.
 */
type YargsHandler = (args: Record<string, unknown>) => unknown

interface RecordedCommand {
  /** The command string's leading words — `"token revoke <id>"` yields `["token", "revoke"]`. */
  readonly words: string[]
  readonly handler?: YargsHandler
  readonly builder?: unknown
}

function leadingWords(command: string): string[] {
  const out: string[] = []
  for (const token of command.trim().split(/\s+/)) {
    if (/^[<[]/.test(token)) break
    out.push(token)
  }
  return out
}

/** Replay one builder and collect the subcommands it registers. */
function children(builder: unknown): RecordedCommand[] {
  const found: RecordedCommand[] = []
  const proxy: any = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "command") {
          return (a: any, _describe?: unknown, builderArg?: unknown, handlerArg?: unknown) => {
            // Module form: .command({ command, builder, handler })
            if (a && typeof a === "object" && typeof a.command === "string") {
              found.push({ words: leadingWords(String(a.command)), handler: a.handler, builder: a.builder })
            }
            // Positional form: .command(name, describe, builder, handler)
            else if (typeof a === "string") {
              found.push({ words: leadingWords(a), handler: handlerArg as YargsHandler, builder: builderArg })
            }
            return proxy
          }
        }
        // Every other builder method is chainable and irrelevant to this walk.
        return () => proxy
      },
    },
  )
  if (typeof builder === "function") (builder as (argv: Argv) => unknown)(proxy as Argv)
  return found
}

/**
 * @param load the yargs module, imported lazily by the caller
 * @param exportName the command exported from it
 * @param subcommands the path from that command down to the one being run
 * @param args the parsed input, already shaped like yargs' `args`
 */
export async function delegate(
  load: () => Promise<Record<string, any>>,
  exportName: string,
  subcommands: ReadonlyArray<string>,
  args: Record<string, unknown>,
): Promise<void> {
  const module = (await load())[exportName]
  if (!module) throw new Error(`${exportName} is not exported by the module backing this command`)

  let handler: YargsHandler | undefined = module.handler
  let builder: unknown = module.builder
  // Consume the path a command string at a time, not a word at a time: a single
  // yargs registration can span several (`"token revoke <id>"`).
  let remaining = [...subcommands]
  while (remaining.length > 0) {
    const candidates = children(builder)
    const match = candidates.find((child) => child.words.every((word, index) => remaining[index] === word))
    if (!match) throw new Error(`subcommand "${remaining.join(" ")}" is not registered by ${exportName}`)
    handler = match.handler
    builder = match.builder
    remaining = remaining.slice(match.words.length)
  }
  if (!handler) throw new Error(`no handler for ${[exportName, ...subcommands].join(" ")}`)

  // yargs always supplies these two; a handler that reads either would see
  // `undefined` and misbehave in ways that are tedious to trace.
  await handler({ _: [], $0: "nikcli", ...args })
}
