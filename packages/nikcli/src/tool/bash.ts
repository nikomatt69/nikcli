import { Effect, Schema } from "effect"
import { zod } from "@/util/effect-zod"
import { spawn, type SpawnOptions } from "child_process"
import { Tool } from "./tool"
import path from "path"
import DESCRIPTION from "./bash.txt"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { lazyAsync } from "@/util/lazy"
import { Language } from "web-tree-sitter"

import { fileURLToPath } from "url"
import { Flag } from "@/flag/flag.ts"
import { Shell } from "@/shell/shell"
import * as os from "os"
import { realpath } from "fs/promises"

import { BashArity } from "@/permission/arity"
import { splitShellStatements } from "@/permission/shell-split"
import { Truncate } from "./truncation"
import { Plugin } from "@/plugin"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"

export const MAX_METADATA_LENGTH = 30_000
export const MAX_OUTPUT_LENGTH = 5 * 1024 * 1024

/**
 * Accumulates process output into a bounded rolling window that keeps the END of the stream.
 *
 * The tail is what explains the run — the failing assertion, the stack trace, the exit status —
 * whereas the head of an oversized stream is almost always progress noise. Dropping the tail (or
 * refusing to append once the cap is hit) hands the model a transcript that stops right before the
 * part it needs.
 */
export function appendOutput(current: string, chunk: Buffer): { output: string; truncated: boolean } {
  const text = chunk.toString()
  const combined = current + text
  if (combined.length <= MAX_OUTPUT_LENGTH) return { output: combined, truncated: false }
  return {
    output: combined.slice(combined.length - MAX_OUTPUT_LENGTH),
    truncated: true,
  }
}

/** Same principle as {@link appendOutput}, applied to the shorter model-facing metadata preview. */
export function previewOutput(text: string): string {
  if (text.length <= MAX_METADATA_LENGTH) return text
  return "...\n\n" + text.slice(text.length - MAX_METADATA_LENGTH)
}
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

const PLATFORM_LABEL =
  process.platform === "darwin"
    ? "macOS"
    : process.platform === "win32"
      ? "Windows"
      : process.platform === "linux"
        ? "Linux"
        : process.platform

function normalizePathInput(value: string) {
  return value
    .trim()
    .replace(/^["'`]|["'`]$/g, "")
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
  for (const command of splitShellStatements(input)) {
    const tokens = commandTokens(command).map((token) => stripQuotedToken(token))
    if (tokens.length === 0) continue
    registerCommandSignals(tokens, cwd, directories, patterns, always, pendingPathResolutions)
  }
}

/** Resolved shell invocation after plugins have had a chance to rewrite it. */
export type ShellInvocation = {
  command: string
  cwd: string
  timeout: number
  shell?: string
  env: Record<string, string>
}

/**
 * Runs the `shell.create.before` plugin hook and returns the resulting invocation.
 *
 * A failing or missing hook must never block the shell tool, so plugin errors fall back to the
 * caller's original invocation.
 */
export async function triggerShellCreateBefore(input: {
  sessionID: string
  command: string
  cwd: string
  timeout: number
}): Promise<ShellInvocation> {
  const output: ShellInvocation = {
    command: input.command,
    cwd: input.cwd,
    timeout: input.timeout,
    shell: undefined,
    env: {},
  }

  await runPromiseWithLayer(
    Plugin.defaultLayer,
    withCurrentInstance(
      Effect.gen(function* () {
        const plugin = yield* Plugin.Service
        yield* plugin.trigger("shell.create.before", { sessionID: input.sessionID, command: input.command }, output)
      }),
    ),
  ).catch((error) => {
    log.warn("shell.create.before hook failed", { error: String(error) })
  })

  if (typeof output.timeout !== "number" || !Number.isFinite(output.timeout) || output.timeout < 0) {
    output.timeout = input.timeout
  }
  if (!output.command) output.command = input.command
  if (!output.cwd) output.cwd = input.cwd
  return output
}

export async function authorizeBashCommand(command: string, cwd: string, ctx: Tool.Context) {
  const directories = new Set<string>()
  if (!Instance.containsPath(cwd)) directories.add(cwd)
  const patterns = new Set<string>()
  const always = new Set<string>()

  // The tree-sitter grammar we bundle is Bash. Running it over PowerShell yields command nodes
  // that do not correspond to what PowerShell will actually execute, so a compound PowerShell line
  // could be authorized from a misread of its first cmdlet. Split those ourselves instead.
  const powershell = Shell.isPowerShell(command)

  const tree = powershell
    ? undefined
    : await Promise.resolve(parser())
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
    // The model otherwise guesses the shell dialect from the OS, which is wrong whenever the
    // resolved shell is not the platform default (zsh vs bash on macOS, Git Bash or PowerShell on
    // Windows) — and a command in the wrong dialect fails for reasons the model cannot see.
    description: DESCRIPTION.replaceAll("${directory}", Instance.directory)
      .replaceAll("${platform}", PLATFORM_LABEL)
      .replaceAll("${shell}", Shell.describe())
      .replaceAll("${maxLines}", String(Truncate.MAX_LINES))
      .replaceAll("${maxBytes}", String(Truncate.MAX_BYTES)),
    parameters: zod(
      Schema.Struct({
        command: Schema.String.annotate({
          description: "The command to execute",
        }),
        timeout: Schema.optional(Schema.Number).annotate({
          description: "Optional timeout in milliseconds",
        }),
        workdir: Schema.optional(Schema.String).annotate({
          description: `The working directory to run the command in. Defaults to ${Instance.directory}. Use this instead of 'cd' commands.`,
        }),
        // Opencode #26419: local OpenAI-compatible backends (llama.cpp, LM Studio,
        // LiteLLM) sometimes omit `description`. Make it optional and synthesize a
        // short fallback so the TUI never shows empty titles.
        description: Schema.optional(Schema.String).annotate({
          description:
            "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
        }),
      }),
    ),
    async execute(params, ctx) {
      if (params.timeout !== undefined && params.timeout < 0) {
        throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be a positive number.`)
      }

      // Plugins get to rewrite the invocation before anything else looks at it. Everything below —
      // including the permission check — then runs against the *final* command, cwd and shell, so a
      // hook cannot slip a different command past an approval granted for the original one.
      const invocation = await triggerShellCreateBefore({
        sessionID: ctx.sessionID,
        command: params.command,
        cwd: params.workdir || Instance.directory,
        timeout: params.timeout ?? DEFAULT_TIMEOUT,
      })

      const shell = invocation.shell ?? Shell.select(invocation.command)
      log.info("bash tool using shell", { shell })

      const cwd = invocation.cwd
      const timeout = invocation.timeout

      // Local openai-compatible backends often omit `description`. Synthesize
      // a short title so the TUI never shows an empty header (opencode #26419).
      const description = params.description?.trim() || "Shell"

      // Publish title + empty output immediately so the TUI shows the running
      // command (and description) before permission prompts / spawn latency.
      ctx.metadata({
        title: description,
        metadata: {
          output: "",
          description,
          command: invocation.command,
        },
      })

      await authorizeBashCommand(invocation.command, cwd, ctx)

      const spawnOptions: SpawnOptions = {
        cwd,
        env: {
          ...process.env,
          ...invocation.env,
        },
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
        // Agents run shell commands in the background; on Windows a spawned console would flash a
        // window in front of whatever the user is doing.
        windowsHide: true,
      }
      // PowerShell needs flags Node's `shell:` option cannot pass, so it is spawned directly.
      const direct = Shell.directInvocation(shell, invocation.command)
      const proc = direct
        ? spawn(direct.file, direct.args, spawnOptions)
        : spawn(invocation.command, { shell, ...spawnOptions })

      let output = ""
      let outputTruncated = false
      const append = (chunk: Buffer) => {
        const result = appendOutput(output, chunk)
        output = result.output
        // Latch: once the window has rolled, the beginning is gone for the rest of the run.
        outputTruncated = outputTruncated || result.truncated
        ctx.metadata({
          metadata: {
            output: previewOutput(output),
            description,
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

      if (outputTruncated) {
        resultMetadata.push(
          `Output exceeded ${MAX_OUTPUT_LENGTH} characters; the beginning was omitted and the most recent output retained`,
        )
      }

      if (resultMetadata.length > 0) {
        output += "\n\n<bash_metadata>\n" + resultMetadata.join("\n") + "\n</bash_metadata>"
      }

      return {
        title: description,
        metadata: {
          output: previewOutput(output),
          exit: proc.exitCode,
          description,
        },
        output,
      }
    },
  }
})
