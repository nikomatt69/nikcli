import type { Diagnostic } from "../codemode";
import { ToolError } from "../tool-error";
import { copyOut, ToolRuntimeError, type SafeObject } from "../tool-runtime";
import {
  type AstNode,
  type CodeModeValue,
  formatLocation,
  InterpreterRuntimeError,
  ProgramThrow,
  sourceLocation,
} from "./model";
import { containsRuntimeReference } from "./references";
import { spreadItems } from "../stdlib/collections";
import {
  coerceToString,
  createAggregateErrorValue,
  createErrorValue,
  errorConstructors,
} from "../stdlib/value";

export const normalizeError = (error: unknown): Diagnostic => {
  if (error instanceof InterpreterRuntimeError) {
    const base = {
      kind: error.kind,
      message: `${error.message}${formatLocation(error.node)}`,
    };
    const located = error.node?.loc
      ? { ...base, location: sourceLocation(error.node) }
      : base;
    return error.suggestions
      ? { ...located, suggestions: error.suggestions }
      : located;
  }

  if (error instanceof ToolRuntimeError) {
    const base = { kind: error.kind, message: error.message };
    return error.suggestions.length > 0
      ? { ...base, suggestions: error.suggestions }
      : base;
  }

  if (error instanceof ToolError) {
    return { kind: "ToolFailure", message: error.message };
  }

  if (error instanceof ProgramThrow) {
    const value = error.value;
    let message: string;
    if (containsRuntimeReference(value)) {
      // Never expose runtime reference internals through thrown values.
      message = "a non-data value";
    } else if (typeof value === "string") {
      message = value;
    } else if (
      value !== null &&
      typeof value === "object" &&
      typeof (value as { message?: unknown }).message === "string"
    ) {
      message = (value as { message: string }).message;
    } else {
      try {
        message = JSON.stringify(copyOut(value)) ?? String(value);
      } catch {
        message = String(value);
      }
    }
    return { kind: "ExecutionFailure", message: `Uncaught: ${message}` };
  }

  if (
    error instanceof RangeError &&
    /call stack|recursion/i.test(error.message)
  ) {
    return {
      kind: "ExecutionFailure",
      message: "Execution exceeded the maximum nesting depth.",
    };
  }

  if (error instanceof Error) {
    return {
      kind: error.name === "SyntaxError" ? "ParseError" : "ExecutionFailure",
      message: error.message,
    };
  }

  return {
    kind: "ExecutionFailure",
    message: String(error),
  };
};

export const caughtErrorValue = (
  thrown: unknown,
): SafeObject | CodeModeValue => {
  // SAFETY: `ProgramThrow` values come from the interpreter's own evaluation, so they are already in the interpreter value domain.
  if (thrown instanceof ProgramThrow) return thrown.value as CodeModeValue;
  if (thrown instanceof InterpreterRuntimeError)
    return createErrorValue(thrown.errorName, thrown.message);
  const name =
    thrown instanceof Error && errorConstructors.has(thrown.name)
      ? thrown.name
      : "Error";
  return createErrorValue(name, normalizeError(thrown).message);
};

export const constructErrorValue = (
  name: string,
  args: Array<unknown>,
  node: AstNode,
): SafeObject => {
  if (name !== "AggregateError")
    return createErrorValue(
      name,
      args[0] === undefined ? "" : coerceToString(args[0]),
    );
  const errors = spreadItems(args[0]);
  if (errors === undefined) {
    throw new InterpreterRuntimeError(
      "new AggregateError(...) expects an array of errors (e.g. new AggregateError(errors, message?)).",
      node,
    ).as("TypeError");
  }
  // Error values must not alias caller-owned arrays.
  return createAggregateErrorValue(
    [...errors],
    args[1] === undefined ? "" : coerceToString(args[1]),
  );
};
