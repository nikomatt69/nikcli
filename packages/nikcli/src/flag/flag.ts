function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

export namespace Flag {
  export const NIKCLI_AUTO_SHARE = truthy("NIKCLI_AUTO_SHARE")
  export const NIKCLI_GIT_BASH_PATH = process.env["NIKCLI_GIT_BASH_PATH"]
  export const NIKCLI_CONFIG = process.env["NIKCLI_CONFIG"]
  export declare const NIKCLI_CONFIG_DIR: string | undefined
  export const NIKCLI_CONFIG_CONTENT = process.env["NIKCLI_CONFIG_CONTENT"]
  export const NIKCLI_DISABLE_AUTOUPDATE = truthy("NIKCLI_DISABLE_AUTOUPDATE")
  export const NIKCLI_DISABLE_PRUNE = truthy("NIKCLI_DISABLE_PRUNE")
  export const NIKCLI_DISABLE_TERMINAL_TITLE = truthy("NIKCLI_DISABLE_TERMINAL_TITLE")
  export const NIKCLI_PERMISSION = process.env["NIKCLI_PERMISSION"]
  export const NIKCLI_DISABLE_DEFAULT_PLUGINS = truthy("NIKCLI_DISABLE_DEFAULT_PLUGINS")
  export const NIKCLI_DISABLE_LSP_DOWNLOAD = truthy("NIKCLI_DISABLE_LSP_DOWNLOAD")
  export const NIKCLI_ENABLE_EXPERIMENTAL_MODELS = truthy("NIKCLI_ENABLE_EXPERIMENTAL_MODELS")
  export const NIKCLI_DISABLE_AUTOCOMPACT = truthy("NIKCLI_DISABLE_AUTOCOMPACT")
  export const NIKCLI_DISABLE_MODELS_FETCH = truthy("NIKCLI_DISABLE_MODELS_FETCH")
  export const NIKCLI_DISABLE_CLAUDE_CODE = truthy("NIKCLI_DISABLE_CLAUDE_CODE")
  export const NIKCLI_DISABLE_CLAUDE_CODE_PROMPT =
    NIKCLI_DISABLE_CLAUDE_CODE || truthy("NIKCLI_DISABLE_CLAUDE_CODE_PROMPT")
  export const NIKCLI_DISABLE_CLAUDE_CODE_SKILLS =
    NIKCLI_DISABLE_CLAUDE_CODE || truthy("NIKCLI_DISABLE_CLAUDE_CODE_SKILLS")
  export const NIKCLI_DISABLE_EXTERNAL_SKILLS =
    NIKCLI_DISABLE_CLAUDE_CODE_SKILLS || truthy("NIKCLI_DISABLE_EXTERNAL_SKILLS")
  export declare const NIKCLI_DISABLE_PROJECT_CONFIG: boolean
  export const NIKCLI_FAKE_VCS = process.env["NIKCLI_FAKE_VCS"]
  export const NIKCLI_CLIENT = process.env["NIKCLI_CLIENT"] ?? "cli"
  export const NIKCLI_SERVER_PASSWORD = process.env["NIKCLI_SERVER_PASSWORD"]
  export const NIKCLI_SERVER_USERNAME = process.env["NIKCLI_SERVER_USERNAME"]
  export const NIKCLI_SERVER_TAILSCALE_AUTH = truthy("NIKCLI_SERVER_TAILSCALE_AUTH")
  export const NIKCLI_SERVER_TAILSCALE_USERS = process.env["NIKCLI_SERVER_TAILSCALE_USERS"]

  // OpenTelemetry (OTLP) — standard env vars. Setting an endpoint enables export.
  export const OTEL_EXPORTER_OTLP_ENDPOINT = process.env["OTEL_EXPORTER_OTLP_ENDPOINT"]
  export const OTEL_EXPORTER_OTLP_HEADERS = process.env["OTEL_EXPORTER_OTLP_HEADERS"]
  // Live telemetry capture (spans streamed to the TUI panel) is on by default;
  // set this to opt out of the in-process span capture entirely.
  export const NIKCLI_DISABLE_OTEL_LIVE = truthy("NIKCLI_DISABLE_OTEL_LIVE")

  // SSH Server
  export const NIKCLI_SERVER_SSH_ENABLED = truthy("NIKCLI_SERVER_SSH_ENABLED")
  export const NIKCLI_SERVER_SSH_PORT = parseInt(process.env["NIKCLI_SERVER_SSH_PORT"] ?? "2222")
  export const NIKCLI_SERVER_SSH_HOST = process.env["NIKCLI_SERVER_SSH_HOST"] ?? "0.0.0.0"

  // Connectors
  export const NIKCLI_FIGMA_TOKEN = process.env["NIKCLI_FIGMA_TOKEN"]
  export const NIKCLI_SLACK_BOT_TOKEN = process.env["NIKCLI_SLACK_BOT_TOKEN"]
  export const NIKCLI_GITHUB_TOKEN = process.env["NIKCLI_GITHUB_TOKEN"]
  export const NIKCLI_GITHUB_OAUTH_CLIENT_ID =
    process.env["NIKCLI_GITHUB_OAUTH_CLIENT_ID"] ??
    process.env["GITHUB_CLIENT_ID_CONSOLE"] ??
    process.env["GITHUB_CLIENT_ID"] ??
    undefined
  export const NIKCLI_LOVABLE_TOKEN = process.env["NIKCLI_LOVABLE_TOKEN"] ?? process.env["NIKCLI_LOVABLE_API_KEY"]
  export const NIKCLI_LOVABLE_API_KEY = process.env["NIKCLI_LOVABLE_API_KEY"]

  // Notifications
  export const NIKCLI_SLACK_CHANNEL =
    process.env["NIKCLI_SLACK_CHANNEL"] ?? process.env["SLACK_DEFAULT_CHANNEL"] ?? process.env["SLACK_CHANNEL"]
  export const NIKCLI_DISCORD_WEBHOOK_URL =
    process.env["NIKCLI_DISCORD_WEBHOOK_URL"] ?? process.env["DISCORD_WEBHOOK_URL"]
  export const NIKCLI_TODO_NOTIFICATIONS = true
  export const NIKCLI_SLACK_TASK_NOTIFICATIONS =
    truthy("NIKCLI_SLACK_TASK_NOTIFICATIONS") || truthy("SLACK_TASK_NOTIFICATIONS")
  export const NIKCLI_DISCORD_TASK_NOTIFICATIONS =
    truthy("NIKCLI_DISCORD_TASK_NOTIFICATIONS") || truthy("DISCORD_TASK_NOTIFICATIONS")

  // TUI plugin system
  export declare const NIKCLI_TUI_CONFIG: string | undefined
  export const NIKCLI_PURE = truthy("NIKCLI_PURE")
  export const NIKCLI_PLUGIN_META_FILE = process.env["NIKCLI_PLUGIN_META_FILE"]

  // Experimental
  export const NIKCLI_EXPERIMENTAL = truthy("NIKCLI_EXPERIMENTAL")
  export declare const NIKCLI_EXPERIMENTAL_HTTPAPI: boolean
  export const NIKCLI_EXPERIMENTAL_FILEWATCHER = true
  export const NIKCLI_EXPERIMENTAL_DISABLE_FILEWATCHER = truthy("NIKCLI_EXPERIMENTAL_DISABLE_FILEWATCHER")
  export const NIKCLI_EXPERIMENTAL_ICON_DISCOVERY = NIKCLI_EXPERIMENTAL || truthy("NIKCLI_EXPERIMENTAL_ICON_DISCOVERY")
  export const NIKCLI_EXPERIMENTAL_DISABLE_COPY_ON_SELECT = truthy("NIKCLI_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
  export const NIKCLI_ENABLE_EXA =
    truthy("NIKCLI_ENABLE_EXA") || NIKCLI_EXPERIMENTAL || truthy("NIKCLI_EXPERIMENTAL_EXA")
  export const NIKCLI_EXPERIMENTAL_BASH_MAX_OUTPUT_LENGTH = number("NIKCLI_EXPERIMENTAL_BASH_MAX_OUTPUT_LENGTH")
  export const NIKCLI_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS = number("NIKCLI_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS")
  export const NIKCLI_EXPERIMENTAL_OUTPUT_TOKEN_MAX = number("NIKCLI_EXPERIMENTAL_OUTPUT_TOKEN_MAX")
  export const NIKCLI_EXPERIMENTAL_OXFMT = true
  export const NIKCLI_EXPERIMENTAL_LSP_TY = true
  export const NIKCLI_EXPERIMENTAL_LSP_TOOL = true
  export const NIKCLI_DISABLE_FILETIME_CHECK = truthy("NIKCLI_DISABLE_FILETIME_CHECK")
  export const NIKCLI_EXPERIMENTAL_PLAN_MODE = true
  export const NIKCLI_EXPERIMENTAL_SCOUT = true
  export const NIKCLI_EXPERIMENTAL_WORKSPACES_TUI = true
  export const NIKCLI_EXPERIMENTAL_SECURITY_TOOL = true
  export const NIKCLI_EXPERIMENTAL_WEBSOCKETS = true

  function number(key: string) {
    const value = process.env[key]
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }
}

// Dynamic getter for NIKCLI_DISABLE_PROJECT_CONFIG
Object.defineProperty(Flag, "NIKCLI_DISABLE_PROJECT_CONFIG", {
  get() {
    return truthy("NIKCLI_DISABLE_PROJECT_CONFIG")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for NIKCLI_CONFIG_DIR
Object.defineProperty(Flag, "NIKCLI_CONFIG_DIR", {
  get() {
    return process.env["NIKCLI_CONFIG_DIR"]
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "NIKCLI_TUI_CONFIG", {
  get() {
    return process.env["NIKCLI_TUI_CONFIG"]
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "NIKCLI_EXPERIMENTAL_HTTPAPI", {
  get() {
    return truthy("NIKCLI_EXPERIMENTAL_HTTPAPI")
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Flag, "NIKCLI_GITHUB_OAUTH_CLIENT_ID", {
  get() {
    return (
      process.env["NIKCLI_GITHUB_OAUTH_CLIENT_ID"] ??
      process.env["GITHUB_CLIENT_ID_CONSOLE"] ??
      process.env["GITHUB_CLIENT_ID"]
    )
  },
  enumerable: true,
  configurable: false,
})
