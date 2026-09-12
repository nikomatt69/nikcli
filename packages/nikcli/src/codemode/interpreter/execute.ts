import { parse } from "acorn"
import { Cause, Effect, Scope } from "effect"
import type { DataValue, Diagnostic, ExecuteOptions, ResolvedExecutionLimits, Result } from "../codemode"
import { copyIn, copyOut, ToolRuntime, type HostTools, type Services } from "../tool-runtime"
import { normalizeError } from "./errors"
import { InterpreterRuntimeError, isRecord, type ProgramNode } from "./model"
import { PromiseRuntime } from "./promises"
import { Interpreter } from "./runtime"

export const executeWithLimits = <const Tools extends Record<string, unknown>>(
  options: ExecuteOptions<Tools>,
  limits: ResolvedExecutionLimits,
  searchIndex: ToolRuntime.DiscoveryPlan["searchIndex"],
): Effect.Effect<Result, never, Services<Tools>> => {
  if (options.code.trim().length === 0) {
    return Effect.succeed({
      ok: false,
      error: { kind: "ParseError", message: "Code cannot be empty." },
      toolCalls: [],
    })
  }

  // Allocate execution state inside suspension so reused Effects never share it.
  return Effect.suspend(() => {
    const tools = ToolRuntime.make(
      (options.tools ?? {}) as HostTools<Services<Tools>>,
      limits.maxToolCalls,
      searchIndex,
      {
        onToolCallStart: options.onToolCallStart,
        onToolCallEnd: options.onToolCallEnd,
      },
    )
    const logs: Array<string> = []
    const logged = () => (logs.length > 0 ? { logs: [...logs] } : {})
    // Set only after copy-out so timeouts cannot report invalid values as completed.
    let returned: { value: DataValue; promises: PromiseRuntime<Services<Tools>> } | undefined

    const base = Effect.acquireUseRelease(
      Scope.make("parallel"),
      (scope) =>
        Effect.gen(function* () {
          const program = parseProgram(options.code)
          const promises = new PromiseRuntime<Services<Tools>>(scope)
          const interpreter = new Interpreter<Services<Tools>>(tools.invoke, tools.search, tools.keys, promises, logs)
          const value = yield* interpreter.run(program)
          const result = copyOut(copyIn(value, "Execution result"), true) as DataValue
          returned = { value: result, promises }
          const warnings = yield* promises.interrupt()
          return {
            ok: true,
            value: result,
            ...(warnings.length > 0 ? { warnings } : undefined),
            ...logged(),
            toolCalls: tools.calls,
          } satisfies Result
        }),
      (scope, exit) => Scope.close(scope, exit),
    )
    const timeoutMs = limits.timeoutMs
    const operation =
      timeoutMs === undefined
        ? base
        : base.pipe(
            Effect.timeoutOrElse({
              duration: timeoutMs,
              orElse: () =>
                Effect.sync(() => {
                  if (returned === undefined) {
                    return {
                      ok: false,
                      error: { kind: "TimeoutExceeded", message: `Execution timed out after ${timeoutMs}ms.` },
                      ...logged(),
                      toolCalls: tools.calls,
                    } satisfies Result
                  }
                  // Keep the timeout warning first so truncation preserves it.
                  return {
                    ok: true,
                    value: returned.value,
                    warnings: [
                      {
                        kind: "TimeoutExceeded",
                        message: `The program returned, but background work was still running at the ${timeoutMs}ms timeout and was interrupted. Await all started promises.`,
                      },
                      ...returned.promises.diagnostics(),
                    ],
                    ...logged(),
                    toolCalls: tools.calls,
                  } satisfies Result
                }),
            }),
          )

    return operation.pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.succeed({
              ok: false,
              error: normalizeError(Cause.squash(cause)),
              ...logged(),
              toolCalls: tools.calls,
            } satisfies Result),
      ),
      Effect.map((result) =>
        limits.maxOutputBytes === undefined ? result : boundOutput(result, limits.maxOutputBytes),
      ),
    )
  })
}

/**
 * Bun's native transpiler instead of `typescript`'s `transpileModule`.
 *
 * Importing `typescript` for this one call pulled the whole 10MB compiler into
 * every process that registers the tool registry — ~39MB RSS and ~130ms of
 * module evaluation at boot, paid by `nikcli --version` as much as by a real
 * codemode run. Bun ships the same type-stripping natively, so this deletes the
 * dependency rather than deferring it: no first-use cost moves anywhere.
 *
 * Type stripping is all `parseProgram` ever wanted — the output is immediately
 * re-parsed by acorn, so only the erased-JS shape matters, not TS semantics.
 *
 * `deadCodeElimination: false` is load-bearing: Bun drops side-effect-free
 * expression statements by default, and codemode returns the value of the final
 * top-level expression, so `1; 2` must survive transpilation as `1; 2`.
 */
const transpiler = new Bun.Transpiler({ loader: "ts", target: "bun", deadCodeElimination: false })

/**
 * Bun rejects a few programs that `transpileModule` emits happily, because it
 * enforces early errors a syntax-only TS transpile never checks — `const c = 1;
 * c = 2` is the one with parity consequences: real JS throws that as a *runtime*
 * TypeError the program can catch, so refusing it at transpile time would change
 * observable behaviour. Fall back to the real compiler whenever Bun disagrees.
 *
 * `require` rather than a static import so `typescript` is only evaluated if
 * this path is actually taken; it must never re-enter the boot graph.
 */
const transpileWithTypescript = (source: string): string => {
  const ts = require("typescript") as typeof import("typescript")
  const transpiled = ts.transpileModule(source, {
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  })
  const diagnostic = transpiled.diagnostics?.find((item) => item.category === ts.DiagnosticCategory.Error)
  if (diagnostic) {
    throw new InterpreterRuntimeError(
      `Failed to parse TypeScript: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`,
      undefined,
      "ParseError",
    )
  }
  return transpiled.outputText
}

const parseProgram = (code: string): ProgramNode => {
  const source = `async function __codemode__() {\n${code}\n}`
  let outputText: string
  try {
    outputText = transpiler.transformSync(source)
  } catch {
    outputText = transpileWithTypescript(source)
  }

  const bodyStart = outputText.indexOf("{") + 1
  const bodyEnd = outputText.lastIndexOf("}")
  const executableCode = outputText.slice(bodyStart, bodyEnd)
  const parsed = parse(executableCode, {
    ecmaVersion: "latest",
    sourceType: "script",
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    locations: true,
  }) as unknown

  if (!isRecord(parsed) || parsed.type !== "Program" || !Array.isArray(parsed.body)) {
    throw new InterpreterRuntimeError("Failed to parse script as a Program node.")
  }

  return parsed as ProgramNode
}

const utf8ByteLength = (value: string): number => new TextEncoder().encode(value).byteLength

// Drop a replacement character produced by truncating inside a UTF-8 sequence.
const utf8Truncate = (value: string, maxBytes: number): string => {
  const bytes = new TextEncoder().encode(value)
  if (bytes.byteLength <= maxBytes) return value
  const text = new TextDecoder("utf-8").decode(bytes.slice(0, Math.max(0, maxBytes)))
  return text.endsWith("\uFFFD") ? text.slice(0, -1) : text
}

// Warnings have a separate budget so result data cannot starve diagnostics.
const boundOutput = (result: Result, maxOutputBytes: number): Result => {
  let truncated = false

  let value: DataValue = null
  let valueBytes = 0
  if (result.ok) {
    const serialized = JSON.stringify(result.value) ?? "null"
    const bytes = utf8ByteLength(serialized)
    if (bytes > maxOutputBytes) {
      truncated = true
      value = `${utf8Truncate(serialized, maxOutputBytes)} [result truncated: ${bytes} bytes exceeds the ${maxOutputBytes}-byte output limit; return a smaller value]`
      valueBytes = maxOutputBytes
    } else {
      value = result.value
      valueBytes = bytes
    }
  }

  const warnings = result.ok ? (result.warnings ?? []) : []
  const keptWarnings: Array<Diagnostic> = []
  let warningBytes = 0
  for (const warning of warnings) {
    const bytes = utf8ByteLength(JSON.stringify(warning)) + 1
    if (warningBytes + bytes > maxOutputBytes) break
    warningBytes += bytes
    keptWarnings.push(warning)
  }
  if (keptWarnings.length < warnings.length) {
    truncated = true
    keptWarnings.push({
      kind: "Truncated",
      message: `${warnings.length - keptWarnings.length} additional warnings omitted by the output limit.`,
    })
  }

  const logs = result.logs ?? []
  const kept: Array<string> = []
  const logBudget = Math.max(0, maxOutputBytes - valueBytes)
  let logBytes = 0
  for (const line of logs) {
    const lineBytes = utf8ByteLength(line) + 1
    if (logBytes + lineBytes > logBudget) break
    logBytes += lineBytes
    kept.push(line)
  }
  if (kept.length < logs.length) {
    truncated = true
    kept.push(`[logs truncated: showing ${kept.length} of ${logs.length} lines]`)
  }

  if (!truncated) return result
  const warningsPart = keptWarnings.length > 0 ? { warnings: keptWarnings } : {}
  const logsPart = kept.length > 0 ? { logs: kept } : {}
  return result.ok
    ? {
        ok: true,
        value,
        ...warningsPart,
        ...logsPart,
        truncated: true,
        toolCalls: result.toolCalls,
      }
    : { ok: false, error: result.error, ...logsPart, truncated: true, toolCalls: result.toolCalls }
}
