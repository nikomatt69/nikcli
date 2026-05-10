import { Log } from "@/util/log"
import { ConfigMarkdown } from "@/config/markdown"
import { Config } from "../config/config"
import { MCP } from "../mcp"
import { Provider } from "../provider/provider"
import { UI } from "./ui"

const log = Log.create({ service: "error-formatter" })

export function FormatError(input: unknown): string | undefined {
  if (MCP.Failed.isInstance(input)) {
    log.debug("Formatting MCP error", { serverName: input.data.name })
    return `MCP server "${input.data.name}" failed. Note, nikcli does not support MCP authentication yet.`
  }

  if (Provider.ModelNotFoundError.isInstance(input)) {
    const { providerID, modelID, suggestions } = input.data
    const message = [
      `Model not found: ${providerID}/${modelID}`,
      ...(Array.isArray(suggestions) && suggestions.length
        ? ["Did you mean: " + suggestions.join(", ")]
        : []),
      `Try: \`nikcli models\` to list available models`,
      `Or check your config (nikcli.json) provider/model names`,
    ].join("\n")
    log.debug("Formatting model not found error", { providerID, modelID })
    return message
  }

  if (Provider.InitError.isInstance(input)) {
    log.debug("Formatting provider init error", { providerID: input.data.providerID })
    return `Failed to initialize provider "${input.data.providerID}". Check credentials and configuration.`
  }

  if (Config.JsonError.isInstance(input)) {
    const message =
      `Config file at ${input.data.path} is not valid JSON(C)` +
      (input.data.message ? `: ${input.data.message}` : "")
    log.warn("Config JSON error", { path: input.data.path, message: input.data.message })
    return message
  }

  if (Config.ConfigDirectoryTypoError.isInstance(input)) {
    log.debug("Formatting config directory typo error", {
      dir: input.data.dir,
      suggestion: input.data.suggestion,
    })
    return `Directory "${input.data.dir}" in ${input.data.path} is not valid. Rename the directory to "${input.data.suggestion}" or remove it. This is a common typo.`
  }

  if (ConfigMarkdown.FrontmatterError.isInstance(input)) {
    log.debug("Formatting frontmatter error", { message: input.data.message })
    return input.data.message
  }

  if (Config.InvalidError.isInstance(input)) {
    log.debug("Formatting config invalid error", { path: input.data.path, issues: input.data.issues?.length })
    return [
      `Configuration is invalid${
        input.data.path && input.data.path !== "config" ? ` at ${input.data.path}` : ""
      }` +
        (input.data.message ? `: ${input.data.message}` : ""),
      ...(input.data.issues?.map((issue) => "↳ " + issue.message + " " + issue.path.join(".")) ?? []),
    ].join("\n")
  }

  if (UI.CancelledError.isInstance(input)) {
    return undefined
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
      log.debug("Failed to serialize error object")
      return "Unexpected error (unserializable)"
    }
  }

  const stringified = String(input)
  log.debug("Converting primitive error", { value: stringified })
  return stringified
}
