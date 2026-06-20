import { RequestError } from "@agentclientprotocol/sdk"

/**
 * Tagged ACP service errors, mirroring opencode's ACPError namespace.
 *
 * The error family carries the typed reason an ACP call failed so the agent
 * layer can convert them into proper JSON-RPC `RequestError`s with stable
 * codes (`-32602` invalid params, `-32003` auth required, `-32601`
 * method not found, `-32603` internal error).
 *
 * Every error sets a string `_tag` prefixed with `ACP` so callers can
 * pattern-match by `error._tag` without `instanceof` and so the type
 * union stays a single, narrow family that fits an Effect error channel.
 */

interface ACPErrorTag {
  readonly _tag: string
}

export class SessionNotFoundError extends Error implements ACPErrorTag {
  readonly _tag = "ACPSessionNotFoundError"
  constructor(readonly sessionId: string) {
    super(`session not found: ${sessionId}`)
    this.name = "SessionNotFoundError"
  }
}

export class InvalidConfigOptionError extends Error implements ACPErrorTag {
  readonly _tag = "ACPInvalidConfigOptionError"
  constructor(readonly configId: string) {
    super(`unknown config option: ${configId}`)
    this.name = "InvalidConfigOptionError"
  }
}

export class InvalidModelError extends Error implements ACPErrorTag {
  readonly _tag = "ACPInvalidModelError"
  constructor(
    readonly modelId: string,
    readonly providerId?: string,
  ) {
    super(`model not found: ${modelId}`)
    this.name = "InvalidModelError"
  }
}

export class InvalidEffortError extends Error implements ACPErrorTag {
  readonly _tag = "ACPInvalidEffortError"
  constructor(readonly effort: string) {
    super(`effort not found: ${effort}`)
    this.name = "InvalidEffortError"
  }
}

export class InvalidModeError extends Error implements ACPErrorTag {
  readonly _tag = "ACPInvalidModeError"
  constructor(readonly mode: string) {
    super(`mode not found: ${mode}`)
    this.name = "InvalidModeError"
  }
}

export class AuthRequiredError extends Error implements ACPErrorTag {
  readonly _tag = "ACPAuthRequiredError"
  constructor(readonly providerId?: string) {
    super("provider authentication required")
    this.name = "AuthRequiredError"
  }
}

export class UnknownAuthMethodError extends Error implements ACPErrorTag {
  readonly _tag = "ACPUnknownAuthMethodError"
  constructor(readonly methodId: string) {
    super(`unknown auth method: ${methodId}`)
    this.name = "UnknownAuthMethodError"
  }
}

export class UnsupportedOperationError extends Error implements ACPErrorTag {
  readonly _tag = "ACPUnsupportedOperationError"
  constructor(readonly method: string) {
    super(`unsupported operation: ${method}`)
    this.name = "UnsupportedOperationError"
  }
}

export class ServiceFailureError extends Error implements ACPErrorTag {
  readonly _tag = "ACPServiceFailureError"
  constructor(
    readonly safeMessage: string,
    readonly service?: string,
  ) {
    super(safeMessage)
    this.name = "ServiceFailureError"
  }
}

/**
 * Union of every typed ACP error. Used by the service layer's error
 * handlers and by `toRequestError` to dispatch to the right JSON-RPC
 * error code.
 */
export type Error =
  | SessionNotFoundError
  | InvalidConfigOptionError
  | InvalidModelError
  | InvalidEffortError
  | InvalidModeError
  | AuthRequiredError
  | UnknownAuthMethodError
  | UnsupportedOperationError
  | ServiceFailureError

export function toRequestError(error: Error): RequestError {
  switch (error._tag) {
    case "ACPSessionNotFoundError":
      return RequestError.invalidParams({ sessionId: error.sessionId }, `session not found: ${error.sessionId}`)
    case "ACPInvalidConfigOptionError":
      return RequestError.invalidParams({ configId: error.configId }, `unknown config option: ${error.configId}`)
    case "ACPInvalidModelError":
      return RequestError.invalidParams(
        { providerId: error.providerId, modelId: error.modelId },
        `model not found: ${error.modelId}`,
      )
    case "ACPInvalidEffortError":
      return RequestError.invalidParams({ effort: error.effort }, `effort not found: ${error.effort}`)
    case "ACPInvalidModeError":
      return RequestError.invalidParams({ mode: error.mode }, `mode not found: ${error.mode}`)
    case "ACPAuthRequiredError":
      return RequestError.authRequired({ providerId: error.providerId }, "provider authentication required")
    case "ACPUnknownAuthMethodError":
      return RequestError.invalidParams({ methodId: error.methodId }, `unknown auth method: ${error.methodId}`)
    case "ACPUnsupportedOperationError":
      return RequestError.methodNotFound(error.method)
    case "ACPServiceFailureError":
      return RequestError.internalError({ service: error.service }, error.safeMessage)
  }
}

/**
 * Wrap any unknown throwable (defect, plain Error, non-Error) into the
 * safe `ServiceFailureError` envelope so the boundary never leaks
 * implementation detail to the client.
 */
export function fromUnknownDefect(_defect: unknown, safeMessage = "Internal service failure"): ServiceFailureError {
  return new ServiceFailureError(safeMessage)
}

/**
 * Convenience helper to construct a `ServiceFailureError` with the structured
 * shape (`safeMessage`, `service`) used across the ACP service layer.
 */
export function serviceFailure(safeMessage: string, service?: string): ServiceFailureError {
  return new ServiceFailureError(safeMessage, service)
}

/**
 * Type guard used by the service layer to recognize errors that already
 * belong to the ACP error family, so we don't double-wrap them.
 */
export function isACPError(error: unknown): error is Error {
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    typeof (error as { _tag: unknown })._tag === "string" &&
    (error as { _tag: string })._tag.startsWith("ACP")
  )
}

export * as ACPError from "./error"
