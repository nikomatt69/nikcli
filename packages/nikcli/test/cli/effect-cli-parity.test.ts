import { preserveTestEnv } from "../helpers/env"
import { describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { Argv } from "@/cli/cmd/argv"
import { removeTestDir } from "../helpers/fs"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-cli-parity-home-"))
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
 * Holds the generated `effect/unstable/cli` tree to the yargs commands it replaces.
 *
 * `src/cli/commands.ts` is generated from these same declarations, so this is
 * not a formality: a generator bug, a hand-edit, or a yargs command that changes
 * without the tree being regenerated all show up here. The failure mode being
 * guarded is not a crash — it is a dropped alias, a flipped default, a
 * positional that quietly became required. Those ship silently.
 *
 * Both sides are read by **running the declarations**, not parsing them. yargs
 * builders are functions and can compute their options; a regex cannot see that,
 * and a comparison that can be fooled is worse than none because it makes an
 * unverified migration look verified.
 *
 * Scope: names, aliases, kind and optionality. **Values are compared by
 * `effect-cli-parse-parity.test.ts`**, which parses real argv — and it earns its
 * keep: `remote start` and `mobile serve` override `--hostname` to `0.0.0.0`
 * through yargs' `.default()` *method*, which the generator ignored. This file
 * passed 150/150 throughout, because the flag was declared identically. Only the
 * parsed value differed.
 */
const { Commands } = await import("@/cli/commands")

interface Param {
  readonly name: string
  readonly kind: "flag" | "argument"
  readonly aliases: string[]
  readonly optional: boolean
}

/** `"token revoke <id>"` → `["token", "revoke"]`; brackets end the path. */
function leadingWords(command: string): string[] {
  const out: string[] = []
  for (const token of command.trim().split(/\s+/)) {
    if (/^[<[]/.test(token)) break
    out.push(token)
  }
  return out
}

function positionalRequired(command: string, name: string) {
  const token = command
    .trim()
    .split(/\s+/)
    .find((candidate) => candidate.replace(/[<>[\].]/g, "") === name)
  return token !== undefined && token.startsWith("<")
}

// ── the yargs side ────────────────────────────────────────────────────────────

interface YargsNode {
  readonly params: Param[]
  readonly children: Map<string, YargsNode>
}

function recordYargs(module: { command?: string; builder?: unknown }): YargsNode {
  const params: Param[] = []
  const children = new Map<string, YargsNode>()
  const command = module.command ?? ""

  const add = (name: string, config: any, kind: "flag" | "argument") => {
    const alias = config?.alias
    const aliases = alias === undefined ? [] : Array.isArray(alias) ? [...alias] : [alias]
    params.push({
      name,
      kind,
      aliases: aliases.sort(),
      optional:
        kind === "argument"
          ? !positionalRequired(command, name)
          : config?.demandOption !== true,
    })
  }

  const register = (childCommand: string, childModule: { command?: string; builder?: unknown }) => {
    const words = leadingWords(childCommand)
    // A multi-word command string is a path: create the intermediate groups.
    let target = children
    for (const word of words.slice(0, -1)) {
      const existing = target.get(word) ?? { params: [], children: new Map() }
      target.set(word, existing)
      target = existing.children
    }
    const leaf = words[words.length - 1]!
    const recorded = recordYargs(childModule)
    const existing = target.get(leaf)
    target.set(leaf, existing ? { params: recorded.params, children: mergeInto(existing.children, recorded.children) } : recorded)
  }

  const proxy: any = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "option" || property === "options") {
          return (name: any, config?: any) => {
            if (typeof name === "string") add(name, config, "flag")
            else for (const [key, value] of Object.entries(name ?? {})) add(key, value, "flag")
            return proxy
          }
        }
        if (property === "positional") {
          return (name: string, config?: any) => {
            add(name, config, "argument")
            return proxy
          }
        }
        if (property === "command") {
          return (a: any, _describe?: unknown, builderArg?: unknown) => {
            if (a && typeof a === "object" && typeof a.command === "string") register(a.command, a)
            else if (typeof a === "string") register(a, { command: a, builder: builderArg })
            return proxy
          }
        }
        return () => proxy
      },
    },
  )

  const builder = module.builder
  if (typeof builder === "function") (builder as (argv: Argv) => unknown)(proxy as Argv)
  else if (builder && typeof builder === "object") {
    for (const [key, value] of Object.entries(builder)) add(key, value, "flag")
  }
  return { params: params.sort(byName), children }
}

function mergeInto(into: Map<string, YargsNode>, from: Map<string, YargsNode>) {
  for (const [key, value] of from) into.set(key, value)
  return into
}

const byName = (a: Param, b: Param) => a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind)

// ── the effect side ───────────────────────────────────────────────────────────

function fromEffectParam(node: any, kind: "flag" | "argument"): Param | undefined {
  let current = node
  let optional = false
  while (current && current._tag !== "Single") {
    if (current._tag === "Optional" || current._tag === "WithDefault" || current._tag === "Variadic") optional = true
    current = current.param ?? current.self ?? current.argument ?? current.flag
  }
  if (!current) return undefined
  return { name: current.name, kind, aliases: [...(current.aliases ?? [])].sort(), optional }
}

function fromEffectCommand(spec: any): Param[] {
  const config = spec.config ?? {}
  const flags = (config.flags ?? []).map((flag: unknown) => fromEffectParam(flag, "flag"))
  const args = (config.arguments ?? []).map((argument: unknown) => fromEffectParam(argument, "argument"))
  return [...flags, ...args].filter(Boolean).sort(byName)
}

// ── the comparison ────────────────────────────────────────────────────────────

const { CommandModules } = await import("@/cli/registry")
const registrations = CommandModules.map((entry) => ({ name: entry.exportName, from: entry.from }))

const yargsRoot: YargsNode = { params: [], children: new Map() }
for (const registration of registrations) {
  const specifier = registration.from
  const module = (await import(specifier))[registration.name]
  if (!module) continue
  const recorded = recordYargs(module)
  const words = leadingWords(module.command ?? "")
  // yargs' default command is the program itself, so its params belong to the root.
  if (words[0] === "$0") {
    yargsRoot.params.push(...recorded.params)
    for (const [key, value] of recorded.children) yargsRoot.children.set(key, value)
    continue
  }
  yargsRoot.children.set(words[0]!, recorded)
}
yargsRoot.params.sort(byName)

/** Every command in the effect tree, as `path -> spec`. */
function flattenEffect(node: any, parents: string[] = [], out = new Map<string, any>()) {
  const key = parents.join(" ")
  out.set(key, node.spec)
  for (const [name, child] of Object.entries(node.commands ?? {})) {
    flattenEffect(child, [...parents, name], out)
  }
  return out
}

function findYargs(node: YargsNode, segments: string[]): YargsNode | undefined {
  let current: YargsNode | undefined = node
  for (const segment of segments) current = current?.children.get(segment)
  return current
}

const effectCommands = [...flattenEffect(Commands)]

describe("effect CLI parity with yargs", () => {
  it("declares a non-trivial tree", () => {
    // A generator that emitted nothing would otherwise pass every case below.
    expect(effectCommands.length).toBeGreaterThan(100)
  })

  it.each(effectCommands.map(([key, spec]) => [key === "" ? "(root)" : key, key, spec] as const))(
    "%s: same parameters, aliases and optionality",
    (_label, key, spec) => {
      const segments = key === "" ? [] : key.split(" ")
      const counterpart = findYargs(yargsRoot, segments)
      expect(counterpart, `no yargs command at "${key}"`).toBeDefined()
      // The root's positionals are flags on the effect side, deliberately: an
      // optional positional on a command that also has subcommands swallows the
      // subcommand name as soon as a flag follows, so `nikcli heap --detailed`
      // would run the TUI. `normalizeArgv` rewrites a leading path back into
      // `--project`, so the spelling users type is unchanged. Everything else
      // about the parameter still has to match.
      const expected =
        segments.length === 0
          ? counterpart!.params.map((param) => ({ ...param, kind: "flag" as const })).sort(byName)
          : counterpart!.params
      expect(fromEffectCommand(spec)).toEqual(expected)
    },
  )

  it("has no yargs command missing from the effect tree", () => {
    const missing: string[] = []
    const walk = (node: YargsNode, parents: string[]) => {
      const key = parents.join(" ")
      if (parents.length > 0 && !effectCommands.some(([candidate]) => candidate === key)) missing.push(key)
      for (const [name, child] of node.children) walk(child, [...parents, name])
    }
    walk(yargsRoot, [])
    expect(missing).toEqual([])
  })
})

process.on("beforeExit", () => {
  void removeTestDir(testHome)
})
