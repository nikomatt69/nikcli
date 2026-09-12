#!/usr/bin/env bun
/**
 * Regenerates `src/cli/commands.ts`, `src/cli/handlers/**` and
 * `src/cli/handlers.generated.ts` from the yargs declarations they replace.
 *
 * Two passes. The first *runs* every yargs `builder` against a recording proxy,
 * because a builder is a function and can compute its options — reading the
 * source with a regex would miss that. The second renders the recorded tree as
 * `effect/unstable/cli` specs plus one delegating handler per command.
 *
 * Run it after changing any command under `src/cli/cmd/`, then run
 * `bun test test/cli/effect-cli-parity.test.ts`, which holds the generated tree
 * to the yargs one. See `specs/cli-framework.md`.
 */
import fs from "fs/promises"
import os from "os"
import path from "path"
const home = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-extract-"))
process.env.NIKCLI_TEST_HOME = home
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
for (const k of ["DATA","CACHE","CONFIG","STATE"]) process.env[`XDG_${k}_HOME`] = path.join(home, k.toLowerCase())

interface Param {
  name: string
  kind: "flag" | "argument"
  type?: string
  describe?: string
  aliases: string[]
  default?: unknown
  choices?: unknown[]
  array?: boolean
  demandOption?: boolean
}
interface Cmd {
  command: string
  describe?: string
  params: Param[]
  children: Cmd[]
  demandCommand: boolean
  /** Set on top-level rows: the module and export a handler delegates back to. */
  exportName?: string
  from?: string
}

function record(module: any): Cmd {
  const params: Param[] = []
  const children: Cmd[] = []
  let demandCommand = false
  const add = (name: string, cfg: any, kind: "flag" | "argument") => {
    const aliases = cfg?.alias === undefined ? [] : Array.isArray(cfg.alias) ? cfg.alias : [cfg.alias]
    params.push({
      name, kind,
      type: cfg?.type,
      describe: cfg?.describe ?? cfg?.description,
      aliases: [...aliases],
      ...(cfg && "default" in cfg ? { default: cfg.default } : {}),
      ...(cfg?.choices ? { choices: [...cfg.choices] } : {}),
      ...(cfg?.array !== undefined ? { array: cfg.array } : {}),
      ...(cfg?.demandOption !== undefined ? { demandOption: cfg.demandOption } : {}),
    })
  }
  const proxy: any = new Proxy({}, {
    get(_t, prop) {
      if (prop === "option" || prop === "options") return (n: any, c?: any) => {
        if (typeof n === "string") add(n, c, "flag")
        else for (const [k, v] of Object.entries(n ?? {})) add(k, v, "flag")
        return proxy
      }
      if (prop === "positional") return (n: string, c?: any) => { add(n, c, "argument"); return proxy }
      if (prop === "command") return (a: any, b?: any, c?: any) => {
        // Module form: .command({command, describe, builder, handler})
        if (a && typeof a === "object" && typeof a.command === "string") children.push(record(a))
        // Positional form: .command(name, describe, builder, handler)
        else if (typeof a === "string") children.push(record({ command: a, describe: b, builder: c }))
        return proxy
      }
      if (prop === "demandCommand") return () => { demandCommand = true; return proxy }
      return () => proxy
    },
  })
  if (typeof module.builder === "function") { try { module.builder(proxy) } catch (e) { console.error("builder threw for", module.command, e) } }
  else if (module.builder && typeof module.builder === "object") {
    for (const [k, v] of Object.entries(module.builder)) add(k, v, "flag")
  }
  return { command: module.command, describe: module.describe, params, children, demandCommand }
}

const main = await fs.readFile("src/cli-main.ts", "utf8")
// Both registration forms: static `.command(X)` and the lazy `exported(() => import("..."), "X")`.
const statics = new Map<string, string>()
for (const m of main.matchAll(/import \{ (\w+Command) \} from "([^"]+)"/g)) statics.set(m[1]!, m[2]!)
const targets: Array<{ name: string; from: string }> = []
for (const m of main.matchAll(/\.command\((\w+Command)\)/g)) {
  const from = statics.get(m[1]!)
  if (from) targets.push({ name: m[1]!, from })
}
for (const m of main.matchAll(/exported\(\(\) => import\("([^"]+)"\), "(\w+)"\)/g)) {
  targets.push({ name: m[2]!, from: m[1]! })
}

const out: Array<Cmd & { exportName: string; from: string }> = []
for (const t of targets) {
  const spec = t.from.startsWith("./") ? t.from.replace("./", "@/") : t.from
  const mod: any = await import(spec)
  const cmdModule = mod[t.name]
  if (!cmdModule) { console.error("missing export", t.name, t.from); continue }
  out.push({ ...record(cmdModule), exportName: t.name, from: t.from })
}
const extracted = out

const raw: Cmd[] = extracted as Cmd[]

/**
 * yargs lets a command string be a whole path — `"token revoke <id>"` declares
 * `token` then `revoke`, not a command called "token". Three such strings exist
 * (`mobile token list|revoke`, `sync token create`), and collapsing them to
 * their first word silently merges siblings into one name.
 */
function expand(cmd: Cmd): Cmd {
  const children = cmd.children.map(expand)
  const tokens = cmd.command.trim().split(/\s+/)
  const words: string[] = []
  while (tokens.length && !/^[<[]/.test(tokens[0]!)) words.push(tokens.shift()!)
  if (words.length <= 1) return { ...cmd, children }
  const leaf: Cmd = { ...cmd, command: [words.pop()!, ...tokens].join(" "), children }
  return words.reduceRight<Cmd>(
    (child, word) => ({ command: word, params: [], children: [child], demandCommand: true, exportName: cmd.exportName, from: cmd.from }),
    leaf,
  )
}

/** Two `.command("token …")` strings under one parent are two branches of one group. */
function merge(commands: Cmd[]): Cmd[] {
  const out: Cmd[] = []
  for (const cmd of commands) {
    const name = cmd.command.trim().split(/\s+/)[0]!
    const existing = out.find((c) => c.command.trim().split(/\s+/)[0] === name && c.children.length && cmd.children.length)
    if (existing) existing.children = merge([...existing.children, ...cmd.children])
    else out.push({ ...cmd, children: merge(cmd.children) })
  }
  return out
}

const tree: Cmd[] = merge(raw.map(expand))
const q = (v: unknown) => JSON.stringify(v)
const ident = (s: string) => s.replace(/[^a-zA-Z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : "")).replace(/^./, (c) => c.toUpperCase())
const nameOf = (command: string) => command.trim().split(/\s+/)[0]!

/** yargs encodes positional optionality in the command string: <req> [opt] [rest..] */
function positionalShape(command: string, name: string) {
  const token = command.trim().split(/\s+/).slice(1).find((t) => t.replace(/[<>[\].]/g, "") === name)
  if (!token) return { required: false, variadic: false }
  return { required: token.startsWith("<"), variadic: token.includes("..") }
}

function renderParam(cmd: Cmd, p: Param): string {
  const base = p.kind === "argument" ? "Argument" : "Flag"
  const pipes: string[] = []
  let ctor: string
  if (p.choices?.length) ctor = `${base}.choice(${q(p.name)}, [${p.choices.map(q).join(", ")}])`
  else if (p.type === "boolean") ctor = `${base}.boolean(${q(p.name)})`
  else if (p.type === "number") ctor = `${base}.float(${q(p.name)})`
  else ctor = `${base}.string(${q(p.name)})`

  for (const alias of p.aliases) pipes.push(`${base}.withAlias(${q(alias)})`)
  if (p.describe) pipes.push(`${base}.withDescription(${q(p.describe)})`)

  if (p.kind === "argument") {
    const shape = positionalShape(cmd.command, p.name)
    if (shape.variadic) pipes.push("Argument.variadic")
    else if (!shape.required) pipes.push(p.default !== undefined ? `Argument.withDefault(${q(p.default)})` : "Argument.optional")
  } else if (p.array) {
    pipes.push("Flag.atLeast(0)")
  } else if (p.default !== undefined) {
    pipes.push(`Flag.withDefault(${q(p.default)})`)
  } else if (!p.demandOption) {
    pipes.push("Flag.optional")
  }
  return pipes.length ? `${ctor}.pipe(${pipes.join(", ")})` : ctor
}

const specLines: string[] = []
const handlerFiles: Array<{ file: string; body: string }> = []

function emit(cmd: Cmd, parents: Cmd[], root: Cmd | undefined): string {
  const chain = [...parents, cmd]
  const constName = "Spec" + chain.map((c) => ident(nameOf(c.command))).join("")
  const childNames = cmd.children.map((child) => emit(child, chain, root ?? cmd))
  const parts: string[] = []
  if (cmd.describe) parts.push(`  description: ${q(cmd.describe)},`)
  if (cmd.params.length) {
    parts.push("  params: {")
    for (const p of cmd.params) parts.push(`    ${JSON.stringify(p.name)}: ${renderParam(cmd, p)},`)
    parts.push("  },")
  }
  if (childNames.length) parts.push(`  commands: [${childNames.join(", ")}],`)
  specLines.push(`const ${constName} = Spec.make(${q(nameOf(cmd.command))}${parts.length ? `, {\n${parts.join("\n")}\n}` : ""})\n`)

  // Handlers: only for commands that actually run something (leaves, plus any
  // group that has its own handler). A group whose yargs builder calls
  // `demandCommand()` never runs a body of its own.
  const top = root ?? cmd
  if (cmd.children.length === 0) {
    const dir = chain.slice(0, -1).map((c) => nameOf(c.command))
    const file = path.join("src/cli/handlers", ...dir, `${nameOf(cmd.command)}.ts`)
    const up = "../".repeat(dir.length + 1)
    const treePath = chain.map((c) => `commands${JSON.stringify([nameOf(c.command)])}`).join(".").replace(/commands\["([^"]+)"\]/g, 'commands["$1"]')
    const accessor = "Commands." + chain.map((c) => `commands[${q(nameOf(c.command))}]`).join(".")
    const sub = chain.slice(1).map((c) => nameOf(c.command))
    const mapping = cmd.params.map((p) => {
      const shape = p.kind === "argument" ? positionalShape(cmd.command, p.name) : { required: false, variadic: false }
      const optional =
        p.kind === "argument"
          ? !shape.required && !shape.variadic && p.default === undefined
          : !p.array && p.default === undefined && !p.demandOption
      const value = optional ? `Option.getOrUndefined(input[${q(p.name)}])` : `input[${q(p.name)}]`
      return `    ${JSON.stringify(p.name)}: ${value},`
    })
    const needsOption = mapping.some((line) => line.includes("Option.getOrUndefined"))
    handlerFiles.push({
      file,
      body:
        (needsOption ? 'import { Option } from "effect"\n' : "") +
        `import { Runtime } from "${up}framework/runtime"\n` +
        `import { delegate } from "${up}framework/yargs-bridge"\n` +
        `import { Commands } from "${up}commands"\n\n` +
        `export default Runtime.handler(${accessor}, (input) =>\n` +
        `  delegate(() => import(${q(top.from!.replace(/^\.\//, "@/"))}), ${q(top.exportName!)}, ${q(sub)} as string[], {\n` +
        mapping.join("\n") +
        (mapping.length ? "\n" : "") +
        `  }),\n)\n`,
    })
  }
  return constName
}

const rootCmd = tree.find((c) => nameOf(c.command) === "$0")
const rest = tree.filter((c) => c !== rootCmd)
for (const cmd of rest) emit(cmd, [], undefined)

const header = `import { Argument, Flag } from "effect/unstable/cli"
import { Spec } from "./framework/spec"

/**
 * The command tree — names, descriptions and parameters, and nothing else.
 *
 * **Generated** from the yargs declarations it replaces, then held to them by
 * \`test/cli/effect-cli-parity.test.ts\`. Hand-transcribing ~254 parameters was
 * the alternative, and its failure mode is a dropped alias or a flipped default
 * that nobody notices for weeks.
 *
 * This module must stay free of application imports: it is what \`--help\`,
 * command matching and shell completion read, so anything imported here is
 * evaluated by every invocation — the exact cost the split exists to avoid.
 * Implementations are loaded on demand by \`framework/runtime.ts\`.
 *
 * Mirrors opencode v2's \`packages/cli/src/commands/commands.ts\`.
 * See \`specs/cli-framework.md\`.
 */

`
const roots = rest.map((c) => "Spec" + ident(nameOf(c.command)))
// `$0` is not a subcommand: yargs' default command is the program itself, so its
// params belong on the root and its handler is the root handler.
const rootParams = rootCmd
  ? "  params: {\n" + rootCmd.params.map((p) => `    ${JSON.stringify(p.name)}: ${renderParam(rootCmd, p)},`).join("\n") + "\n  },\n"
  : ""
const footer = `\nexport const Commands = Spec.make("nikcli", {
  description: ${q(rootCmd?.describe ?? "nikcli command line interface")},
${rootParams}  commands: [${roots.join(", ")}],
})\n`

await fs.writeFile("src/cli/commands.ts", header + specLines.join("\n") + footer)
for (const { file, body } of handlerFiles) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, body)
}
if (rootCmd) {
  const mapping = rootCmd.params.map((p) => {
    const shape = p.kind === "argument" ? positionalShape(rootCmd.command, p.name) : { required: false, variadic: false }
    const optional =
      p.kind === "argument"
        ? !shape.required && !shape.variadic && p.default === undefined
        : !p.array && p.default === undefined && !p.demandOption
    return `    ${JSON.stringify(p.name)}: ${optional ? `Option.getOrUndefined(input[${q(p.name)}])` : `input[${q(p.name)}]`},`
  })
  await fs.writeFile(
    "src/cli/handlers/default.ts",
    'import { Option } from "effect"\n' +
      'import { Runtime } from "../framework/runtime"\n' +
      'import { delegate } from "../framework/yargs-bridge"\n' +
      'import { Commands } from "../commands"\n\n' +
      "/** The default command: `nikcli [project]` starts the TUI. */\n" +
      "export default Runtime.handler(Commands, (input) =>\n" +
      `  delegate(() => import(${q(rootCmd.from!.replace(/^\.\//, "@/"))}), ${q(rootCmd.exportName!)}, [] as string[], {\n` +
      mapping.join("\n") + "\n  }),\n)\n",
  )
}

// The loader map, mirroring the tree shape the runtime expects.
function loaders(cmd: Cmd, parents: Cmd[], indent: string): string {
  const chain = [...parents, cmd]
  const dir = chain.map((c) => nameOf(c.command))
  if (cmd.children.length === 0) return `${indent}${q(nameOf(cmd.command))}: () => import("./handlers/${dir.join("/")}"),`
  const inner = cmd.children.map((child) => loaders(child, chain, indent + "  ")).join("\n")
  return `${indent}${q(nameOf(cmd.command))}: {\n${inner}\n${indent}},`
}
const map = rest.map((c) => loaders(c, [], "  ")).join("\n")
await fs.writeFile(
  "src/cli/handlers.generated.ts",
  "/** Generated by `script/tmp/generate-cli.ts` — the loader tree `Runtime.handlers` binds. */\n" +
    'import { Commands } from "./commands"\n' +
    'import { Runtime } from "./framework/runtime"\n\n' +
    "export const Handlers = Runtime.handlers(Commands, {\n" +
    (rootCmd ? '  $: () => import("./handlers/default"),\n' : "") +
    map +
    "\n})\n",
)
console.log(`wrote src/cli/commands.ts (${specLines.length} specs), ${handlerFiles.length + (rootCmd ? 1 : 0)} handlers, handlers.generated.ts`)
