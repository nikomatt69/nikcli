import { Log } from "@/util/log"
import { ConfigMarkdown } from "@/config/markdown"
import { Config } from "../config/config"
import { MCP } from "../mcp"
import { Provider } from "../provider/provider"
import { UI } from "./ui"

const log = Log.create({ service: "error-formatter" })

export function FormatError(input: unknown): string | undefined {
  if (input instanceof MCP.Failed) {
    log.debug("Formatting MCP error", { serverName: input.name })
    return `MCP server "${input.name}" failed. Note, nikcli does not support MCP authentication yet.`
  }

  if (input instanceof Provider.ModelNotFoundError) {
    const { providerID, modelID, suggestions } = input
    const message = [
      `Model not found: ${providerID}/${modelID}`,
      ...(Array.isArray(suggestions) && suggestions.length ? ["Did you mean: " + suggestions.join(", ")] : []),
      `Try: \`nikcli models\` to list available models`,
      `Or check your config (nikcli.json) provider/model names`,
    ].join("\n")
    log.debug("Formatting model not found error", { providerID, modelID })
    return message
  }

  if (input instanceof Provider.InitError) {
    log.debug("Formatting provider init error", { providerID: input.providerID })
    return `Failed to initialize provider "${input.providerID}". Check credentials and configuration.`
  }

  if (input instanceof Config.JsonError) {
    const message = `Config file at ${input.path} is not valid JSON(C)` + (input.message ? `: ${input.message}` : "")
    log.warn("Config JSON error", { path: input.path, message: input.message })
    return message
  }

  if (input instanceof Config.ConfigDirectoryTypoError) {
    log.debug("Formatting config directory typo error", {
      dir: input.dir,
      suggestion: input.suggestion,
    })
    return `Directory "${input.dir}" in ${input.path} is not valid. Rename the directory to "${input.suggestion}" or remove it. This is a common typo.`
  }

  if (input instanceof ConfigMarkdown.FrontmatterError) {
    log.debug("Formatting frontmatter error", { message: input.message })
    return input.message
  }

  if (input instanceof Config.InvalidError) {
    const issues = input.issues as Array<{ message: string; path: string[] }> | undefined
    log.debug("Formatting config invalid error", { path: input.path, issues: issues?.length })
    return [
      `Configuration is invalid${input.path && input.path !== "config" ? ` at ${input.path}` : ""}` +
        (input.message ? `: ${input.message}` : ""),
      ...(issues?.map((issue) => "↳ " + issue.message + " " + issue.path.join(".")) ?? []),
    ].join("\n")
  }

  if (input instanceof UI.CancelledError) {
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
