import { errorMessage, errorFormat } from "@/util/error"

export type PluginErrorCode =
  | "load-failed"
  | "manifest-invalid"
  | "incompatible-version"
  | "entry-not-found"
  | "permission-denied"
  | "install-failed"
  | "uninstall-failed"
  | "config-invalid"
  | "hook-execution-failed"
  | "dependency-missing"
  | "path-not-found"
  | "validation-failed"
  | "duplicate-plugin"
  | "network-error"
  | "timeout-error"
  | "git-auth-failed"
  | "git-clone-failed"
  | "source-not-found"

export type PluginError =
  | { code: "load-failed"; spec: string; cause?: unknown }
  | { code: "manifest-invalid"; spec: string; errors: string[]; cause?: unknown }
  | { code: "incompatible-version"; spec: string; required: string; current: string; cause?: unknown }
  | { code: "entry-not-found"; spec: string; entry: string; cause?: unknown }
  | { code: "permission-denied"; spec: string; permission: string; cause?: unknown }
  | { code: "install-failed"; spec: string; cause?: unknown }
  | { code: "uninstall-failed"; spec: string; cause?: unknown }
  | { code: "config-invalid"; file: string; errors: string[]; cause?: unknown }
  | { code: "hook-execution-failed"; hook: string; spec?: string; cause?: unknown }
  | { code: "dependency-missing"; spec: string; dependency: string; cause?: unknown }
  | { code: "path-not-found"; path: string; cause?: unknown }
  | { code: "validation-failed"; spec: string; field: string; reason: string; cause?: unknown }
  | { code: "duplicate-plugin"; spec: string; existing: string; cause?: unknown }
  | { code: "network-error"; url: string; cause?: unknown }
  | { code: "timeout-error"; operation: string; timeout: number; cause?: unknown }
  | { code: "git-auth-failed"; url: string; cause?: unknown }
  | { code: "git-clone-failed"; url: string; cause?: unknown }
  | { code: "source-not-found"; spec: string; cause?: unknown }

export function createPluginError(code: PluginErrorCode, data: Omit<PluginError, "code">): PluginError {
  return { code, ...data } as PluginError
}

export function isPluginError(value: unknown): value is PluginError {
  if (typeof value !== "object" || value === null) return false
  const obj = value as Record<string, unknown>
  return typeof obj.code === "string" && obj.code.includes("-")
}

export function getPluginErrorMessage(error: PluginError): string {
  switch (error.code) {
    case "load-failed":
      return `Failed to load plugin ${error.spec}: ${errorMessage(error.cause)}`
    case "manifest-invalid":
      return `Plugin ${error.spec} has invalid manifest: ${error.errors.join(", ")}`
    case "incompatible-version":
      return `Plugin ${error.spec} requires nikcli ${error.required}, but running ${error.current}`
    case "entry-not-found":
      return `Plugin ${error.spec} is missing ${error.entry} entry point`
    case "permission-denied":
      return `Permission denied for plugin ${error.spec}: ${error.permission}`
    case "install-failed":
      return `Failed to install plugin ${error.spec}: ${errorMessage(error.cause)}`
    case "uninstall-failed":
      return `Failed to uninstall plugin ${error.spec}: ${errorMessage(error.cause)}`
    case "config-invalid":
      return `Invalid plugin config ${error.file}: ${error.errors.join(", ")}`
    case "hook-execution-failed":
      const hook = error.hook + (error.spec ? ` (${error.spec})` : "")
      return `Hook ${hook} execution failed: ${errorMessage(error.cause)}`
    case "dependency-missing":
      return `Plugin ${error.spec} is missing required dependency: ${error.dependency}`
    case "path-not-found":
      return `Plugin path not found: ${error.path}`
    case "validation-failed":
      return `Plugin ${error.spec} validation failed for field '${error.field}': ${error.reason}`
    case "duplicate-plugin":
      return `Plugin ${error.spec} is already installed as ${error.existing}`
    case "network-error":
      return `Network error fetching ${error.url}: ${errorMessage(error.cause)}`
    case "timeout-error":
      return `Timeout after ${error.timeout}ms during ${error.operation}`
    case "git-auth-failed":
      return `Git authentication failed for ${error.url}: ${errorMessage(error.cause)}`
    case "git-clone-failed":
      return `Git clone failed for ${error.url}: ${errorMessage(error.cause)}`
    case "source-not-found":
      return `Plugin source not found: ${error.spec}`
    default:
      return `Unknown plugin error: ${JSON.stringify(error)}`
  }
}

export function getPluginErrorDetails(error: PluginError): Record<string, unknown> {
  const details: Record<string, unknown> = { code: error.code }
  for (const [key, value] of Object.entries(error)) {
    if (key === "code" || key === "cause") continue
    details[key] = value
  }
  if (error.cause !== undefined) {
    details.cause = errorFormat(error.cause)
  }
  return details
}

export class PluginErrorException extends Error {
  readonly #error: PluginError

  constructor(error: PluginError) {
    super(getPluginErrorMessage(error))
    this.name = "PluginError"
    this.#error = error
  }

  get pluginError(): PluginError {
    return this.#error
  }

  toJSON(): PluginError {
    return this.#error
  }
}
