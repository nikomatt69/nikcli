import { Command } from "effect/unstable/cli"

/**
 * The command tree, as data.
 *
 * A `Spec.Node` carries a name, an `effect/unstable/cli` command (its
 * description and parameters) and its children — and nothing else. No handler,
 * no import of the code that implements it. That is the whole point: the module
 * holding the tree can stay free of application dependencies, so `--help`,
 * command matching and shell completion never load an implementation.
 *
 * Ported from opencode v2's `packages/cli/src/framework/spec.ts`.
 * See `specs/background-service.md` for why the CLI process is being kept thin.
 */
export interface Node<
  Name extends string,
  Spec extends Command.Command<Name, any, any, any, any>,
  Commands extends Children,
> {
  readonly name: Name
  readonly spec: Spec
  readonly commands: Commands
  readonly aliases: ReadonlyArray<Any>
}

export type Any = Node<string, Command.Command<any, any, any, any, any>, Children>
export type Children = Readonly<Record<string, Any>>

type Options<Config extends Command.Command.Config, Commands extends ReadonlyArray<Any>> = {
  readonly description?: string
  readonly aliases?: ReadonlyArray<string>
  readonly params?: Config
  readonly commands?: Commands
}

type ChildrenOf<Commands extends ReadonlyArray<Any>> = {
  readonly [Node in Commands[number] as Node["name"]]: Node
}

export function make<
  const Name extends string,
  const Config extends Command.Command.Config = {},
  const Commands extends ReadonlyArray<Any> = [],
>(name: Name, options: Options<Config, Commands> = {}) {
  const aliases = options.aliases ?? []
  const params = options.params ?? ({} as Config)
  const command = Command.make(name, params)
  const described = options.description ? command.pipe(Command.withDescription(options.description)) : command
  // Effect carries a single native alias, rendered inline as `name, alias` in
  // help. Any further aliases become sibling commands that share the same params
  // and subcommands — yargs allowed a list, and dropping the extras silently
  // would break invocations that already work.
  const spec = aliases.length > 0 ? described.pipe(Command.withAlias(aliases[0]!)) : described
  const commands = Object.fromEntries(
    (options.commands ?? []).map((child) => [child.name, child]),
  ) as ChildrenOf<Commands>
  const extra = aliases.slice(1).map((alias) => {
    const aliasCommand = Command.make(alias, params)
    const aliasSpec = options.description
      ? aliasCommand.pipe(Command.withDescription(options.description))
      : aliasCommand
    return { name: alias, spec: aliasSpec, commands, aliases: [] } as unknown as Any
  })
  return {
    name,
    spec,
    commands,
    aliases: extra,
  }
}

export * as Spec from "./spec"
