import z from "zod"
import { Schema } from "effect"
import { zod } from "@/util/effect-zod"
import { spawn } from "child_process"
import { Tool } from "./tool"
import path from "path"
import DESCRIPTION from "./bash.txt"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { lazy, lazyAsync } from "@/util/lazy"
import { Language } from "web-tree-sitter"

import { Filesystem } from "@/util/filesystem"
import { fileURLToPath } from "url"
import { Flag } from "@/flag/flag.ts"
import { Shell } from "@/shell/shell"
import * as os from "os"
import { realpath } from "fs/promises"

import { BashArity } from "@/permission/arity"
import { Truncate } from "./truncation"

const MAX_METADATA_LENGTH = 30_000
const DEFAULT_TIMEOUT = Flag.NIKCLI_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS || 2 * 60 * 1000

const SHELL_FILE_ARG_COMMANDS = new Set([
  "cd",
  "rm",
  "cp",
  "mv",
  "mkdir",
  "touch",
  "chmod",
  "chown",
  "copy-item",
  "move-item",
  "remove-item",
  "new-item",
  "rename-item",
  "set-location",
])

export const log = Log.create({ service: "bash-tool" })

function normalizePathInput(value: string) {
  return value
    .trim()
    .replace(/^[\"'`]|[\"'`]$/g, "")
    .trim()
}

function looksLikeGlob(value: string) {
  return /[*?[\]{}]/.test(value)
}

function commandTokens(input: string) {
  const regex = /"([^"\\]|\\.)*"|'([^'\\]|\\.)*'|`([^`\\]|\\.)*`|\S+/g
  return input.match(regex) ?? []
}

function stripQuotedToken(token: string) {
  return token.replace(/^"|"$/g, "").replace(/^'|'$/g, "").replace(/^`|`$/g, "")
}

function isOptionToken(token: string) {
  return token.startsWith("-") || token.startsWith("$(") || (token.startsWith("${") && token.endsWith("}"))
}

async function resolveCommandPath(token: string, cwd: string) {
  const cleaned = normalizePathInput(stripQuotedToken(token))
  if (!cleaned) return undefined

  const expanded = cleaned.startsWith("~") ? path.join(os.homedir(), cleaned.slice(1)) : cleaned
  const absolute = path.isAbsolute(expanded) ? expanded : path.resolve(cwd, expanded)
  if (looksLikeGlob(expanded)) return absolute

  const resolved = await realpath(absolute).catch(() => absolute)
  return process.platform === "win32" && resolved.match(/^\/[a-z]\//i)
    ? resolved.replace(/^\/([a-z])\//, (_, drive) => `${drive.toUpperCase()}:\\`).replace(/\//g, "\\")
    : resolved
}

function getPathLikePermissionCandidate(token: string, cwd: string, directories: Set<string>) {
  const value = normalizePathInput(token)
  return resolveCommandPath(value, cwd).then((candidate) => {
    if (!candidate) return
    if (!Instance.containsPath(candidate)) directories.add(candidate)
  })
}

function registerCommandSignals(
  cmd: string[],
  cwd: string,
  directories: Set<string>,
  patterns: Set<string>,
  always: Set<string>,
  pendingPathResolutions: Promise<void>[],
) {
  if (!cmd.length) return
  const normalizedCommand = cmd[0].toLowerCase()
  const args = cmd.slice(1)
  if (SHELL_FILE_ARG_COMMANDS.has(normalizedCommand)) {
    for (const arg of args) {
      if (!arg || isOptionToken(arg) || (normalizedCommand === "chmod" && arg.startsWith("+"))) continue
      pendingPathResolutions.push(getPathLikePermissionCandidate(arg, cwd, directories))
    }
  }

  if (normalizedCommand !== "cd") {
    patterns.add(cmd.join(" "))
    always.add(BashArity.prefix(cmd).join(" ") + "*")
  }
}

function registerCommandSignalsFromFallback(
  input: string,
  cwd: string,
  directories: Set<string>,
  patterns: Set<string>,
  always: Set<string>,
  pendingPathResolutions: Promise<void>[],
) {
  const commands = input
    .split(/&&|\|\||;|\n/)
    .map((part) => part.trim())
    .filter(Boolean)

  for (const command of commands) {
    const tokens = commandTokens(command).map((token) => stripQuotedToken(token))
    if (tokens.length === 0) continue
    registerCommandSignals(tokens, cwd, directories, patterns, always, pendingPathResolutions)
  }
}

export async function authorizeBashCommand(command: string, cwd: string, ctx: Tool.Context) {
  const directories = new Set<string>()
  if (!Instance.containsPath(cwd)) directories.add(cwd)
  const patterns = new Set<string>()
  const always = new Set<string>()

  const tree = await Promise.resolve(parser())
    .then((p) => p.parse(command))
    .catch(() => undefined)

  const pendingPathResolutions: Promise<void>[] = []

  if (!tree) {
    registerCommandSignalsFromFallback(command, cwd, directories, patterns, always, pendingPathResolutions)
  }

  if (tree) {
    for (const node of tree.rootNode.descendantsOfType("command")) {
      if (!node) continue
      const cmd: string[] = []
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (!child) continue
        if (
          child.type !== "command_name" &&
          child.type !== "word" &&
          child.type !== "string" &&
          child.type !== "raw_string" &&
          child.type !== "concatenation"
        ) {
          continue
        }
        cmd.push(child.text)
      }

      registerCommandSignals(cmd, cwd, directories, patterns, always, pendingPathResolutions)
    }
  }

  if (directories.size > 0) {
    await Promise.allSettled(pendingPathResolutions)

    await ctx.ask({
      permission: "external_directory",
      patterns: Array.from(directories),
      always: Array.from(directories).map((x) => path.dirname(x) + "*"),
      metadata: {},
    })
  }

  if (patterns.size > 0) {
    await ctx.ask({
      permission: "bash",
      patterns: Array.from(patterns),
      always: Array.from(always),
      metadata: {},
    })
  }
}

const resolveWasm = (asset: string) => {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
  const url = new URL(asset, import.meta.url)
  return fileURLToPath(url)
}

const parser = lazyAsync(async () => {
  const { Parser } = await import("web-tree-sitter")
  const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, {
    with: { type: "wasm" },
  })
  const treePath = resolveWasm(treeWasm)
  await Parser.init({
    locateFile() {
      return treePath
    },
  })
  const { default: bashWasm } = await import("tree-sitter-bash/tree-sitter-bash.wasm" as string, {
    with: { type: "wasm" },
  })
  const bashPath = resolveWasm(bashWasm)
  const bashLanguage = await Language.load(bashPath)
  const p = new Parser()
  p.setLanguage(bashLanguage)
  return p
})

export const BashTool = Tool.define("bash", async () => {
  return {
    description: DESCRIPTION.replaceAll("${directory}", Instance.directory)
      .replaceAll("${maxLines}", String(Truncate.MAX_LINES))
      .replaceAll("${maxBytes}", String(Truncate.MAX_BYTES)),
    parameters: zod(
      Schema.Struct({
        command: Schema.String.annotate({ description: "The command to execute" }),
        timeout: Schema.optional(Schema.Number).annotate({ description: "Optional timeout in milliseconds" }),
        workdir: Schema.optional(Schema.String).annotate({
          description: `The working directory to run the command in. Defaults to ${Instance.directory}. Use this instead of 'cd' commands.`,
        }),
        description: Schema.String.annotate({
          description:
            "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
        }),
      }),
    ),
    async execute(params, ctx) {
      const shell = Shell.select(params.command)
      log.info("bash tool using shell", { shell })

      const cwd = params.workdir || Instance.directory
      if (params.timeout !== undefined && params.timeout < 0) {
        throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be a positive number.`)
      }
      const timeout = params.timeout ?? DEFAULT_TIMEOUT
      await authorizeBashCommand(params.command, cwd, ctx)

      const proc = spawn(params.command, {
        shell,
        cwd,
        env: {
          ...process.env,
        },
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      })

      let output = ""

      ctx.metadata({
        metadata: {
          output: "",
          description: params.description,
        },
      })

      const append = (chunk: Buffer) => {
        output += chunk.toString()
        ctx.metadata({
          metadata: {
            output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
            description: params.description,
          },
        })
      }

      proc.stdout?.on("data", append)
      proc.stderr?.on("data", append)

      let timedOut = false
      let aborted = false
      let exited = false

      const kill = () => Shell.killTree(proc, { exited: () => exited })

      if (ctx.abort.aborted) {
        aborted = true
        await kill()
      }

      const abortHandler = () => {
        aborted = true
        void kill()
      }

      ctx.abort.addEventListener("abort", abortHandler, { once: true })

      const timeoutTimer = setTimeout(() => {
        timedOut = true
        void kill()
      }, timeout + 100)

      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeoutTimer)
          ctx.abort.removeEventListener("abort", abortHandler)
        }

        proc.once("exit", () => {
          exited = true
          cleanup()
          resolve()
        })

        proc.once("error", (error) => {
          exited = true
          cleanup()
          reject(error)
        })
      })

      const resultMetadata: string[] = []

      if (timedOut) {
        resultMetadata.push(`bash tool terminated command after exceeding timeout ${timeout} ms`)
      }

      if (aborted) {
        resultMetadata.push("User aborted the command")
      }

      if (resultMetadata.length > 0) {
        output += "\n\n<bash_metadata>\n" + resultMetadata.join("\n") + "\n</bash_metadata>"
      }

      return {
        title: params.description,
        metadata: {
          output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
          exit: proc.exitCode,
          description: params.description,
        },
        output,
      }
    },
  }
})
