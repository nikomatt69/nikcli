import { Log } from "@/util/log"
import { UserFacingError } from "@/util/user-error"
import { ConfigMarkdown } from "@/config/markdown"
import { Config } from "../config/config"
import { MCP } from "../mcp"
import { Provider } from "../provider/provider"
import { Agent } from "@/agent/agent"
import { UI } from "./ui"

const log = Log.create({ service: "error-formatter" })

/**
 * Dispatch table keyed by the error's `_tag` discriminator.
 *
 * Each entry receives the typed error instance and returns the user-facing
 * string the CLI should print. Adding a new domain error is one line:
 * declare the `Schema.TaggedErrorClass`, then add a formatter here.
 *
 * Falls through to `defaultFormat` (which keeps the `UserFacingError.format()`
 * legacy path) when `_tag` is not present.
 */
type Formatter = (input: any) => string | undefined

const formatters: Record<string, Formatter> = {
  // Provider
  ProviderHeaderTimeout: (e) => {
    log.debug("Formatting provider header timeout error", { ms: e.ms })
    return `Provider response headers timed out after ${e.ms}ms`
  },
  ProviderModelNotFoundError: (e) => {
    const { providerID, modelID, suggestions } = e
    const message = [
      `Model not found: ${providerID}/${modelID}`,
      ...(Array.isArray(suggestions) && suggestions.length ? ["Did you mean: " + suggestions.join(", ")] : []),
      `Try: \`nikcli models\` to list available models`,
      `Or check your config (nikcli.json) provider/model names`,
    ].join("\n")
    log.debug("Formatting model not found error", { providerID, modelID })
    return message
  },
  ProviderInitError: (e) => {
    log.debug("Formatting provider init error", { providerID: e.providerID })
    return `Failed to initialize provider "${e.providerID}". Check credentials and configuration.`
  },

  // Agent
  AgentNotFound: (e) => {
    log.debug("Formatting agent not found error", { name: e.name })
    return `Agent not found: ${e.name}. Run \`nikcli agents\` to list configured agents.`
  },

  // MCP
  MCPFailed: (e) => {
    log.debug("Formatting MCP error", { serverName: e.name })
    return `MCP server "${e.name}" failed. Note, nikcli does not support MCP authentication yet.`
  },

  // Config
  ConfigJsonError: (e) => {
    const message = `Config file at ${e.path} is not valid JSON(C)` + (e.message ? `: ${e.message}` : "")
    log.warn("Config JSON error", { path: e.path, message: e.message })
    return message
  },
  ConfigDirectoryTypoError: (e) => {
    log.debug("Formatting config directory typo error", {
      dir: e.dir,
      suggestion: e.suggestion,
    })
    return `Directory "${e.dir}" in ${e.path} is not valid. Rename the directory to "${e.suggestion}" or remove it. This is a common typo.`
  },
  ConfigInvalidError: (e) => {
    const issues = e.issues as Array<{ message: string; path: string[] }> | undefined
    log.debug("Formatting config invalid error", { path: e.path, issues: issues?.length })
    return [
      `Configuration is invalid${e.path && e.path !== "config" ? ` at ${e.path}` : ""}` +
        (e.message ? `: ${e.message}` : ""),
      ...(issues?.map((issue) => "↳ " + issue.message + " " + issue.path.join(".")) ?? []),
    ].join("\n")
  },
  ConfigFrontmatterError: (e) => {
    log.debug("Formatting frontmatter error", { message: e.message })
    return e.message
  },

  // UI
  UICancelledError: () => "",

  // User-facing
  UserFacingError: (e) => {
    log.debug("Formatting user-facing error", { title: e.title })
    return e.format()
  },
}

export function FormatError(input: unknown): string | undefined {
  if (input === null || input === undefined) return undefined

  // Fast path: tagged error classes expose `_tag`. Dispatch on the literal
  // discriminator so new tagged classes are caught here without a code change
  // to the CLI diagnostics path.
  if (typeof input === "object" && "_tag" in input) {
    const tag = (input as { _tag: unknown })._tag
    if (typeof tag === "string" && tag in formatters) {
      return formatters[tag](input)
    }
    // Tagged errors are expected failures by design — even without a
    // dedicated formatter, the tag plus its scalar fields beat the opaque
    // "Unexpected error" path.
    if (typeof tag === "string") {
      const record = input as Record<string, unknown>
      const message = typeof record.message === "string" && record.message ? record.message : undefined
      const fields = Object.entries(record)
        .filter(
          ([key, value]) =>
            key !== "_tag" &&
            key !== "message" &&
            (typeof value === "string" || typeof value === "number" || typeof value === "boolean"),
        )
        .map(([key, value]) => `${key}: ${value}`)
        .join(", ")
      log.debug("Formatting tagged error without dedicated formatter", { tag })
      return [message ? `${tag}: ${message}` : tag, fields ? `(${fields})` : undefined].filter(Boolean).join(" ")
    }
  }

  // Safety net: keep `UserFacingError.format()` working for any path that
  // produces a UserFacingError without a recognized `_tag` mapping (e.g. older
  // bundled SDKs or third-party consumers).
  if (input instanceof UserFacingError) {
    return input.format()
  }

  return undefined
}

export function FormatUnknownError(input: unknown): string {
  if (input instanceof Error) {
    log.debug("Formatting unknown error", { name: input.name, message: input.message })
    return input.stack ?? `${input.name}: ${input.message}`
  }

  if (typeof input === "object" && input !== null) {
    try {
      const serialized = JSON.stringify(input, null, 2)
      log.debug("Serialized object error", { keys: Object.keys(input) })
      return serialized
    } catch {
      log.debug("Failed to serialize object error")
      return "Unexpected error (unserializable)"
    }
  }

  const stringified = String(input)
  log.debug("Converting primitive error", { value: stringified })
  return stringified
}
