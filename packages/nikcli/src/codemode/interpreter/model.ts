import type { SafeObject, ToolReference } from "../tool-runtime"
import type { CodeModeData, CodeModePromise, CodeModeURL } from "../values"

export type SourcePosition = {
  line: number
  column: number
}

export type SourceLocation = {
  start: SourcePosition
  end: SourcePosition
}

export type AstNode = {
  type: string
  loc?: SourceLocation
  [key: string]: unknown
}

export type ProgramNode = AstNode & {
  type: "Program"
  body: Array<AstNode>
}

export type Binding = {
  mutable: boolean
  value: CodeModeValue
  initialized?: boolean
}

/**
 * How a statement finished, and — for `break`/`continue` — which label it is looking for.
 *
 * An absent `label` means the nearest enclosing loop, exactly as in JavaScript. A present one travels
 * outward untouched until the construct carrying that label sees it, which is what makes
 * `continue outer` skip the rest of the inner loop *and* the rest of the outer iteration.
 */
export type StatementResult =
  | { kind: "none" }
  | { kind: "return"; value: unknown }
  | { kind: "break"; label?: string }
  | { kind: "continue"; label?: string }

export type MemberReference = {
  target: SafeObject | Array<unknown> | CodeModeURL
  key: string | number
}

export class CodeModeFunction {
  constructor(
    readonly parameters: ReadonlyArray<AstNode>,
    readonly body: AstNode,
    readonly capturedScopes: ReadonlyArray<Map<string, Binding>>,
    readonly async: boolean,
  ) {}
}

/**
 * A value a CodeMode program can bind, produce, or throw: interpreter data,
 * host classes, and the runtime reference objects the interpreter itself owns.
 */
export type CodeModeValue =
  | CodeModeData
  | CodeModeFunction
  | CoercionFunction
  | UriFunction
  | SearchFunction
  | GlobalNamespace
  | PromiseNamespace
  | ErrorConstructorReference
  | CodeModePromise
  | ToolReference
  | PromiseMethodReference
  | PromiseInstanceMethodReference
  | MemberReference
  | IntrinsicReference
  | GlobalMethodReference
  | ComputedValue

export class IntrinsicReference {
  constructor(
    readonly receiver: unknown,
    readonly name: string,
  ) {}
}

export class ComputedValue {
  constructor(readonly value: unknown) {}
}

export class PromiseNamespace {}

export type PromiseMethodName = "all" | "allSettled" | "race" | "any" | "resolve" | "reject"

export class PromiseMethodReference {
  constructor(readonly name: PromiseMethodName) {}
}

export type PromiseInstanceMethodName = "then" | "catch" | "finally"

export class PromiseInstanceMethodReference {
  constructor(
    readonly promise: CodeModePromise,
    readonly name: PromiseInstanceMethodName,
  ) {}
}

export class PromiseCapabilityFunction {
  constructor(readonly settle: (value: unknown) => void) {}
}

export type GlobalNamespaceName =
  | "Object"
  | "Math"
  | "JSON"
  | "Array"
  | "console"
  | "Date"
  | "RegExp"
  | "Map"
  | "Set"
  | "URL"
  | "URLSearchParams"

export class GlobalNamespace {
  constructor(readonly name: GlobalNamespaceName) {}
}

export class GlobalMethodReference {
  constructor(
    readonly namespace: GlobalNamespaceName | "Number" | "String",
    readonly name: string,
  ) {}
}

export class CoercionFunction {
  constructor(readonly name: "Number" | "String" | "Boolean" | "parseInt" | "parseFloat") {}
}

export class UriFunction {
  constructor(readonly name: "encodeURI" | "encodeURIComponent" | "decodeURI" | "decodeURIComponent") {}
}

export class SearchFunction {}

export class ProgramThrow {
  constructor(readonly value: unknown) {}
}

export class ErrorConstructorReference {
  constructor(readonly name: string) {}
}

export type DiagnosticKind =
  | "ParseError"
  | "UnsupportedSyntax"
  | "UnknownTool"
  | "InvalidToolInput"
  | "InvalidToolOutput"
  | "InvalidDataValue"
  | "ToolCallLimitExceeded"
  | "TimeoutExceeded"
  | "ToolFailure"
  | "ExecutionFailure"

export const OptionalShortCircuit: unique symbol = Symbol("codemode.optional-short-circuit")

/**
 * The one-paragraph orientation attached to every syntax refusal.
 *
 * It used to enumerate individual array and string methods, which made it long enough to skim past
 * and still silent on the thing the reader actually needs — what is *not* here. Naming the exclusions
 * is what stops a retry loop: a model that reads "generators are unavailable" writes a plain loop,
 * while one that reads a list it is not on tries `function*` again with different spacing. The full
 * matrix is `specs/v2/codemode-interpreter-support.md`.
 */
export const supportedSyntaxMessage =
  "This is a restricted JavaScript-like language for calling tools. Supported: plain and async functions, data literals, destructuring, optional chaining, template literals, standard control flow (conditionals, switch, labelled loops, for...of and for...in, try/catch), await and Promise combinators over tools.* calls, and common built-ins (Array, Object, Math, JSON, String, Number, Date, RegExp, Map, Set, URL, URLSearchParams, console). Unsupported: generator functions and yield, for await...of, classes and user-defined constructors, this, getters/setters, tagged templates, BigInt, and custom Symbols - use plain functions, data objects, and Promise.all instead."

export class InterpreterRuntimeError extends Error {
  readonly node?: AstNode
  errorName = "Error"

  constructor(
    message: string,
    node?: AstNode,
    readonly kind: DiagnosticKind = "ExecutionFailure",
    readonly suggestions?: ReadonlyArray<string>,
  ) {
    super(message)
    this.name = "InterpreterRuntimeError"
    if (node) this.node = node
  }

  as(errorName: string): this {
    this.errorName = errorName
    return this
  }
}

export const unsupportedSyntax = (kind: string, node: AstNode): InterpreterRuntimeError =>
  new InterpreterRuntimeError(
    `Syntax '${kind}' is not supported in CodeMode. ${supportedSyntaxMessage}`,
    node,
    "UnsupportedSyntax",
    [supportedSyntaxMessage],
  )

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

export const asNode = (value: unknown, context: string): AstNode => {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new InterpreterRuntimeError(`Invalid AST node while reading ${context}.`)
  }
  return value as AstNode
}

export const getArray = (node: AstNode, key: string): Array<unknown> => {
  const value = node[key]
  if (!Array.isArray(value)) throw new InterpreterRuntimeError(`Expected '${key}' to be an array.`, node)
  return value
}

export const getString = (node: AstNode, key: string): string => {
  const value = node[key]
  if (typeof value !== "string") throw new InterpreterRuntimeError(`Expected '${key}' to be a string.`, node)
  return value
}

export const getBoolean = (node: AstNode, key: string): boolean => {
  const value = node[key]
  if (typeof value !== "boolean") throw new InterpreterRuntimeError(`Expected '${key}' to be a boolean.`, node)
  return value
}

export const getOptionalNode = (node: AstNode, key: string): AstNode | undefined => {
  const value = node[key]
  if (value === undefined || value === null) return undefined
  return asNode(value, key)
}

export const getNode = (node: AstNode, key: string): AstNode => asNode(node[key], key)

/**
 * How to name a callee in an error, using only the source shape.
 *
 * Read off the AST rather than the evaluated value on purpose: by the time a call fails, the value is
 * `undefined` or some facade whose name says nothing, while the text the model wrote is what it needs
 * to see quoted back. Returns `undefined` when the callee is an expression with no stable name.
 */
export const describeCallee = (node: AstNode): string | undefined => {
  if (node.type === "Identifier" && typeof node["name"] === "string") return node["name"]
  if (node.type === "MemberExpression" && node["computed"] !== true) {
    const object = isRecord(node["object"]) ? describeCallee(node["object"] as AstNode) : undefined
    const property = isRecord(node["property"]) ? (node["property"] as AstNode)["name"] : undefined
    if (typeof property === "string") return object === undefined ? property : `${object}.${property}`
  }
  return undefined
}

export const notCallableMessage = (node: AstNode): string => {
  const name = describeCallee(node)
  return name === undefined ? "The called value is not a function." : `${name} is not a function.`
}

export const sourceLocation = (node: AstNode): { readonly line: number; readonly column: number } => ({
  line: Math.max(1, (node.loc?.start.line ?? 2) - 1),
  column: Math.max(1, (node.loc?.start.column ?? 4) - 3),
})

export const formatLocation = (node?: AstNode): string => {
  if (!node?.loc) return ""
  const location = sourceLocation(node)
  return ` (line ${location.line}, col ${location.column})`
}
