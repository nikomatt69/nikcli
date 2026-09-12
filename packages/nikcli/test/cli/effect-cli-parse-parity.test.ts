import { preserveTestEnv } from "../helpers/env"
import { describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { Effect as EffectNamespace } from "effect"
import { removeTestDir } from "../helpers/fs"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-parse-parity-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
process.env.XDG_DATA_HOME = path.join(testHome, "data")
process.env.XDG_CACHE_HOME = path.join(testHome, "cache")
process.env.XDG_CONFIG_HOME = path.join(testHome, "config")
process.env.XDG_STATE_HOME = path.join(testHome, "state")

preserveTestEnv([
  "NIKCLI_TEST_HOME",
  "NIKCLI_DISABLE_PROJECT_CONFIG",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
])

/**
 * Parses the same argv with both CLIs and compares the values they produce.
 *
 * `effect-cli-parity.test.ts` compares *declarations* — that two parsers agree a
 * flag exists, is named `--session` and answers to `-s`. It cannot see a
 * difference in what they hand the handler: yargs coerces, fills camelCase and
 * kebab-case spellings, synthesises `--no-x`, and treats repeated flags
 * differently from effect. Those differences do not fail a build; they change
 * behaviour at runtime, for one flag, on one command.
 *
 * This is the harness the entrypoint flip depends on. Without it, "the parsers
 * agree" is a claim about metadata rather than about parsing.
 */
const { Effect, Option } = await import("effect")
const { BunServices } = await import("@effect/platform-bun")
const { Commands } = await import("@/cli/commands")
const { Runtime } = await import("@/cli/framework/runtime")
const yargs = (await import("yargs")).default

/** Walk the spec tree and bind a handler that records the parsed input. */
function capturingHandlers(captured: { path: string[]; input: any }[]) {
  const entries: Array<{ spec: any; load: () => Promise<{ default: (input: any) => void }> }> = []
  const walk = (node: any, parents: string[]) => {
    entries.push({
      spec: node.spec,
      load: async () => ({
        default: (input: any) => {
          captured.push({ path: parents, input })
        },
      }),
    })
    for (const [name, child] of Object.entries(node.commands ?? {})) walk(child, [...parents, name])
  }
  walk(Commands, [])
  return entries
}

async function parseWithEffect(argv: string[]) {
  const captured: { path: string[]; input: any }[] = []
  const handlers = capturingHandlers(captured)
  const effect = Runtime.runWith(Commands, handlers as never, { version: "test", renderErrors: false })(argv)
  await Effect.runPromise(
    (effect as EffectNamespace.Effect<void, unknown, never>).pipe(
      Effect.provide(BunServices.layer),
    ) as EffectNamespace.Effect<void, unknown, never>,
  )
  return captured.at(-1)
}

/**
 * Parse one argv with yargs without letting yargs route.
 *
 * The first version of this wrapped the top-level handler and let yargs dispatch
 * to subcommands. It did not wrap deeply enough, so for nested commands yargs
 * ran the **real** handler — which opened browser tabs on the machine running
 * the suite. A test that executes the commands it is supposed to be parsing is
 * not a test.
 *
 * So: walk the builders ourselves to the leaf module, then register that leaf
 * alone, with our own handler, in a fresh parser. Nothing nested is registered,
 * so there is nothing for yargs to dispatch into.
 */
function leadingWords(command: string): string[] {
  const out: string[] = []
  for (const token of command.trim().split(/\s+/)) {
    if (/^[<[]/.test(token)) break
    out.push(token)
  }
  return out
}

interface Recorded {
  readonly words: string[]
  readonly command: string
  readonly builder?: unknown
  readonly handler?: unknown
}

function childrenOf(builder: unknown): Recorded[] {
  const found: Recorded[] = []
  const proxy: any = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "command") {
          return (a: any, _describe?: unknown, builderArg?: unknown, handlerArg?: unknown) => {
            if (a && typeof a === "object" && typeof a.command === "string") {
              found.push({ words: leadingWords(a.command), command: a.command, builder: a.builder, handler: a.handler })
            } else if (typeof a === "string") {
              found.push({ words: leadingWords(a), command: a, builder: builderArg, handler: handlerArg })
            }
            return proxy
          }
        }
        return () => proxy
      },
    },
  )
  if (typeof builder === "function") (builder as (argv: any) => unknown)(proxy)
  return found
}

/** The yargs module for a command path, or `undefined` if the path is not registered. */
function resolveLeaf(module: any, segments: string[]): { command: string; builder?: unknown } | undefined {
  let current: { command: string; builder?: unknown } = { command: module.command ?? "", builder: module.builder }
  let remaining = [...segments]
  while (remaining.length > 0) {
    const match = childrenOf(current.builder).find((child) =>
      child.words.every((word, index) => remaining[index] === word),
    )
    if (!match) return undefined
    current = { command: match.command, builder: match.builder }
    remaining = remaining.slice(match.words.length)
  }
  return current
}

function parseWithYargs(module: any, segments: string[], pathLength: number, argv: string[]) {
  const leaf = resolveLeaf(module, segments)
  if (!leaf) return undefined
  let captured: Record<string, unknown> | undefined
  const name = leadingWords(leaf.command)
  // Re-root the argv on the leaf so no parent command has to be registered.
  const rest = argv.slice(pathLength)
  yargs([...name, ...rest])
    .command({
      command: leaf.command,
      describe: "",
      builder: leaf.builder as never,
      handler: (args: any) => void (captured = args),
    })
    .exitProcess(false)
    .fail(() => {})
    .parse()
  return captured
}

/**
 * A value both sides can be compared on: unwrap `Option`, normalise arrays.
 *
 * `Option.isOption`, not a shape check — a `None` has no enumerable properties
 * and a `Some` has only `value`, so guessing by shape reads `None` as an empty
 * object and compares it against `undefined`.
 */
function normalise(value: unknown): unknown {
  if (Option.isOption(value)) return normalise(Option.getOrUndefined(value))
  if (Array.isArray(value)) return value.map(normalise)
  return value
}

const { CommandModules } = await import("@/cli/registry")
const modules = new Map(CommandModules.map((entry) => [entry.exportName, entry.from] as const))

/**
 * A sample value for a parameter, taken from what it declares.
 *
 * Guessing from the name alone was the first attempt and it made the harness
 * lie: `--token-budget sample` is a parse error, not a disagreement, and
 * `--format sample` fails a `choices` check. A vector that neither parser
 * accepts tests nothing — and reads as 120 failures.
 */
function sampleFor(name: string, primitive?: { _tag?: string; choiceKeys?: string[] }): string {
  const tag = primitive?._tag
  if (tag === "Choice") return primitive?.choiceKeys?.[0] ?? "default"
  if (tag === "Integer" || tag === "Float") return "1"
  if (/port/i.test(name)) return "4096"
  if (/host/i.test(name)) return "127.0.0.1"
  if (/url/i.test(name)) return "http://example.test"
  if (/dir|path|project|file/i.test(name)) return "/tmp/example"
  return "sample"
}

interface Case {
  readonly label: string
  readonly argv: string[]
  /** The path below the top-level command, so the yargs side walks to the same leaf. */
  readonly segments: string[]
  /** How many argv entries are the command path itself. */
  readonly pathLength: number
  readonly exportName: string
  readonly params: string[]
}

/** For each command: the bare invocation, then one vector per flag. */
function casesFor(node: any, parents: string[], exportName: string): Case[] {
  const config = node.spec.config ?? {}
  const names: Array<{ name: string; boolean: boolean; argument: boolean; primitive?: any }> = []
  const unwrap = (param: any): any => {
    let current = param
    while (current && current._tag !== "Single") current = current.param ?? current.self ?? current.argument ?? current.flag
    return current
  }
  const isOptional = (param: any) => {
    let current = param
    while (current && current._tag !== "Single") {
      if (current._tag === "Optional" || current._tag === "WithDefault" || current._tag === "Variadic") return true
      current = current.param ?? current.self ?? current.argument ?? current.flag
    }
    return false
  }
  const requiredFlags: string[] = []
  for (const flag of config.flags ?? []) {
    const single = unwrap(flag)
    if (!single) continue
    const boolean = single.primitiveType?._tag === "Boolean"
    names.push({ name: single.name, boolean, argument: false, primitive: single.primitiveType })
    // A required flag left out makes every vector for that command a parse
    // error — `mobile pair --public-url` is `demandOption: true` in yargs.
    if (!isOptional(flag)) {
      requiredFlags.push(`--${single.name}`)
      if (!boolean) requiredFlags.push(sampleFor(single.name, single.primitiveType))
    }
  }
  const required: string[] = []
  for (const argument of config.arguments ?? []) {
    const single = unwrap(argument)
    if (!single) continue
    names.push({ name: single.name, boolean: false, argument: true, primitive: single.primitiveType })
    // A bare invocation of a command with a required positional is a parse
    // error on both sides, which tests nothing. Supply one.
    let wrapper = argument
    let optional = false
    while (wrapper && wrapper._tag !== "Single") {
      if (wrapper._tag === "Optional" || wrapper._tag === "WithDefault" || wrapper._tag === "Variadic") optional = true
      wrapper = wrapper.param ?? wrapper.self ?? wrapper.argument ?? wrapper.flag
    }
    if (!optional) required.push(sampleFor(single.name, single.primitiveType))
  }
  const params = names.map((entry) => entry.name)
  const base = [...parents, ...required, ...requiredFlags]
  const label = [...parents].join(" ") || "(root)"
  const segments = parents.slice(1)
  const pathLength = parents.length
  const cases: Case[] = [{ label, argv: base, segments, pathLength, exportName, params }]
  for (const entry of names) {
    if (entry.argument) continue
    // Already in the base vector; repeating it tests how each parser handles a
    // duplicate flag, which is a different question.
    if (requiredFlags.includes(`--${entry.name}`)) continue
    const argv = entry.boolean
      ? [...base, `--${entry.name}`]
      : [...base, `--${entry.name}`, sampleFor(entry.name, entry.primitive)]
    cases.push({ label: `${label} --${entry.name}`, argv, segments, pathLength, exportName, params })
  }
  return cases
}

/** Only leaves: a group's own parse is exercised through its children. */
function collectCases(): Case[] {
  const out: Case[] = []
  const walk = (node: any, parents: string[], exportName: string | undefined) => {
    const children = Object.entries(node.commands ?? {})
    const owner = exportName ?? findExport(parents[0])
    if (children.length === 0 && owner) out.push(...casesFor(node, parents, owner))
    for (const [name, child] of children) walk(child, [...parents, name], owner)
  }
  for (const [name, child] of Object.entries(Commands.commands ?? {})) walk(child, [name], findExport(name))
  return out
}

function findExport(command: string | undefined): string | undefined {
  if (!command) return undefined
  for (const [exportName] of modules) {
    // `ServeCommand` → `serve`, `WorkspaceServeCommand` → `workspace-serve`.
    const kebab = exportName
      .replace(/Command$/, "")
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .toLowerCase()
    if (kebab === command) return exportName
  }
  return undefined
}

const cases = collectCases()

describe("effect CLI parses like yargs", () => {
  it("built a meaningful corpus", () => {
    expect(cases.length).toBeGreaterThan(50)
  })

  /**
   * Cases where the yargs side produced nothing are counted, not asserted.
   *
   * Reaching a *nested* yargs handler means re-implementing how yargs routes
   * through its own builders, and a vector neither side parsed proves nothing
   * either way. Counting them keeps that honest: the coverage assertion below
   * fails if this harness ever quietly stops covering most of the corpus, which
   * is the failure mode of a "skip what is inconvenient" rule.
   */
  const uncovered: string[] = []

  it.each(cases.map((entry) => [entry.label, entry] as const))("%s", async (_label, entry) => {
    const specifier = modules.get(entry.exportName)!
    const module = (await import(specifier))[entry.exportName]
    const fromYargs = parseWithYargs(module, entry.segments, entry.pathLength, entry.argv)
    const fromEffect = await parseWithEffect(entry.argv)
    expect(fromEffect, `effect did not parse ${entry.argv.join(" ")}`).toBeDefined()
    if (fromYargs === undefined) {
      uncovered.push(entry.label)
      return
    }

    for (const name of entry.params) {
      // yargs reserves the `--no-` prefix for boolean negation, so a flag
      // *named* `no-x` can never be set: `--no-tunnel` sets `tunnel: false` and
      // leaves `no-tunnel` at its default. `remote start`'s handler reads
      // `!args.noTunnel`, so the flag is inert today — verified directly against
      // yargs. Effect has no such rule and sets the flag, which is what the flag
      // says it does. Excluded here because the two parsers genuinely differ and
      // effect is the correct one; see `specs/cli-framework.md`.
      if (name.startsWith("no-")) continue
      const effectValue = normalise(fromEffect!.input?.[name])
      const yargsValue = normalise(fromYargs?.[name])
      // yargs leaves an unset flag absent; effect can carry an empty array for a
      // repeatable one. Both mean "not supplied".
      const empty = (value: unknown) => value === undefined || (Array.isArray(value) && value.length === 0)
      if (empty(effectValue) && empty(yargsValue)) continue
      expect({ name, value: effectValue }).toEqual({ name, value: yargsValue })
    }
  })

  it("compares most of the corpus against a real yargs parse", () => {
    // Guards the escape hatch above: if the yargs side stops capturing, this
    // suite would otherwise keep passing while asserting nothing.
    expect(uncovered.length).toBeLessThan(cases.length / 2)
  })
})

process.on("beforeExit", () => {
  void removeTestDir(testHome)
})
