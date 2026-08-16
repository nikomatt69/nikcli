import path from "path"
import os from "os"
import { type ParseError as JsoncParseError, parse as parseJsonc, printParseErrorCode } from "jsonc-parser"
import { configFilesInDirectory } from "@nikcli-ai/util/config-file"
import { Filesystem } from "@nikcli-ai/util/filesystem"
import { Flag } from "@nikcli-ai/util/flag"
import { Global } from "@nikcli-ai/util/global"
import { Cause, Context, Effect, Exit, Layer, Schema } from "effect"
import { AppRuntime } from "@/effect/runtime"

export namespace ConfigPaths {
  type MissingMode = "error" | "empty"
  type ParseSource = string | { source: string; dir: string }

  export interface Interface {
    readonly projectFiles: (name: string, directory: string, worktree: string) => Effect.Effect<string[]>
    readonly directories: (directory: string, worktree: string) => Effect.Effect<string[]>
    readonly readFile: (filepath: string) => Effect.Effect<string | undefined, Error>
    readonly parseText: (text: string, input: ParseSource, missing?: MissingMode) => Effect.Effect<unknown, Error>
  }

  export class Service extends Context.Service<Service, Interface>()("@nikcli/ConfigPaths") {}

  const projectFilesEffect = Effect.fn("ConfigPaths.projectFiles")(function* (
    name: string,
    directory: string,
    worktree: string,
  ) {
    const files: string[] = []
    for (const file of [`${name}.jsonc`, `${name}.json`]) {
      const found = yield* Effect.promise(() => Filesystem.findUp(file, directory, worktree))
      for (const resolved of found.toReversed()) {
        files.push(resolved)
      }
    }
    return files
  })

  const directoriesEffect = Effect.fn("ConfigPaths.directories")(function* (directory: string, worktree: string) {
    return [
      Global.Path.config,
      ...(!Flag.NIKCLI_DISABLE_PROJECT_CONFIG
        ? yield* Effect.promise(() =>
            Array.fromAsync(
              Filesystem.up({
                targets: [".nikcli"],
                start: directory,
                stop: worktree,
              }),
            ),
          )
        : []),
      ...(yield* Effect.promise(() =>
        Array.fromAsync(
          Filesystem.up({
            targets: [".nikcli"],
            start: Global.Path.home,
            stop: Global.Path.home,
          }),
        ),
      )),
      ...(Flag.NIKCLI_CONFIG_DIR ? [Flag.NIKCLI_CONFIG_DIR] : []),
    ]
  })

  /** One definition, shared with `@nikcli-ai/util/plugin-install`. */
  export function fileInDirectory(dir: string, name: string) {
    return configFilesInDirectory(dir, name)
  }

  export class JsonError extends Schema.TaggedErrorClass<JsonError>()("ConfigPathsJsonError", {
    path: Schema.String,
    message: Schema.optional(Schema.String),
  }) {}

  export class InvalidError extends Schema.TaggedErrorClass<InvalidError>()("ConfigPathsInvalidError", {
    path: Schema.String,
    issues: Schema.optional(Schema.Unknown),
    message: Schema.optional(Schema.String),
  }) {}

  const readFileEffect = Effect.fn("ConfigPaths.readFile")(function* (filepath: string) {
    return yield* Effect.tryPromise({
      try: () => Filesystem.readText(filepath),
      catch: (err) => err as ErrnoException,
    }).pipe(
      Effect.catch((err: ErrnoException) => {
        if (err.code === "ENOENT") return Effect.succeed(undefined)
        return Effect.fail(Object.assign(new JsonError({ path: filepath }), { cause: err }))
      }),
    )
  })

  function source(input: ParseSource) {
    return typeof input === "string" ? input : input.source
  }

  function dir(input: ParseSource) {
    return typeof input === "string" ? path.dirname(input) : input.dir
  }

  /** Apply {env:VAR} and {file:path} substitutions to config text. */
  const substitute = Effect.fn("ConfigPaths.substitute")(function* (
    text: string,
    input: ParseSource,
    missing: MissingMode = "error",
  ) {
    text = text.replace(/\{env:([^}]+)\}/g, (_, varName) => {
      return process.env[varName] || ""
    })

    const fileMatches = Array.from(text.matchAll(/\{file:[^}]+\}/g))
    if (!fileMatches.length) return text

    const configDir = dir(input)
    const configSource = source(input)
    let out = ""
    let cursor = 0

    for (const match of fileMatches) {
      const token = match[0]
      const index = match.index!
      out += text.slice(cursor, index)

      const lineStart = text.lastIndexOf("\n", index - 1) + 1
      const prefix = text.slice(lineStart, index).trimStart()
      if (prefix.startsWith("//")) {
        out += token
        cursor = index + token.length
        continue
      }

      let filePath = token.replace(/^\{file:/, "").replace(/\}$/, "")
      if (filePath.startsWith("~/")) {
        filePath = path.join(os.homedir(), filePath.slice(2))
      }

      const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(configDir, filePath)
      const fileContent = yield* Effect.tryPromise({
        try: () => Filesystem.readText(resolvedPath),
        catch: (error) => error as ErrnoException,
      }).pipe(
        Effect.catch((error: ErrnoException) => {
          if (missing === "empty") return Effect.succeed("")

          const errMsg = `bad file reference: "${token}"`
          if (error.code === "ENOENT") {
            return Effect.fail(
              Object.assign(
                new InvalidError({
                  path: configSource,
                  message: errMsg + ` ${resolvedPath} does not exist`,
                }),
                { cause: error },
              ),
            )
          }
          return Effect.fail(Object.assign(new InvalidError({ path: configSource, message: errMsg }), { cause: error }))
        }),
      )

      out += JSON.stringify(fileContent.trim()).slice(1, -1)
      cursor = index + token.length
    }

    out += text.slice(cursor)
    return out
  })

  /** Substitute and parse JSONC text, throwing JsonError on syntax errors. */
  const parseTextEffect = Effect.fn("ConfigPaths.parseText")(function* (
    text: string,
    input: ParseSource,
    missing: MissingMode = "error",
  ) {
    const configSource = source(input)
    text = yield* substitute(text, input, missing)

    const errors: JsoncParseError[] = []
    const data = parseJsonc(text, errors, { allowTrailingComma: true })
    if (errors.length) {
      const lines = text.split("\n")
      const errorDetails = errors
        .map((e) => {
          const beforeOffset = text.substring(0, e.offset).split("\n")
          const line = beforeOffset.length
          const column = beforeOffset[beforeOffset.length - 1].length + 1
          const problemLine = lines[line - 1]

          const error = `${printParseErrorCode(e.error)} at line ${line}, column ${column}`
          if (!problemLine) return error

          return `${error}\n   Line ${line}: ${problemLine}\n${"".padStart(column + 9)}^`
        })
        .join("\n")

      return yield* Effect.fail(
        new JsonError({
          path: configSource,
          message: `\n--- JSONC Input ---\n${text}\n--- Errors ---\n${errorDetails}\n--- End ---`,
        }),
      )
    }

    return data
  })

  export const layer = Layer.succeed(Service, {
    projectFiles: projectFilesEffect,
    directories: directoriesEffect,
    readFile: readFileEffect,
    parseText: parseTextEffect,
  })

  export const defaultLayer = layer

  async function runCompat<A, E>(effect: Effect.Effect<A, E>) {
    const exit = await AppRuntime.runPromiseExit(effect)
    if (Exit.isSuccess(exit)) return exit.value
    throw Cause.squash(exit.cause)
  }

  /** Read a config file, returning undefined for missing files and throwing JsonError for other failures. */
  export function readFile(filepath: string) {
    return runCompat(readFileEffect(filepath))
  }

  export function projectFiles(name: string, directory: string, worktree: string) {
    return runCompat(projectFilesEffect(name, directory, worktree))
  }

  export function directories(directory: string, worktree: string) {
    return runCompat(directoriesEffect(directory, worktree))
  }

  export function parseText(text: string, input: ParseSource, missing: MissingMode = "error") {
    return runCompat(parseTextEffect(text, input, missing))
  }
}
