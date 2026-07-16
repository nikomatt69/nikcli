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
  export declare const NIKCLI_ISLAND: boolean
  export const NIKCLI_DISABLE_LSP_DOWNLOAD = truthy("NIKCLI_DISABLE_LSP_DOWNLOAD")
  export const NIKCLI_ENABLE_EXPERIMENTAL_MODELS = truthy("NIKCLI_ENABLE_EXPERIMENTAL_MODELS")
  export const NIKCLI_DISABLE_AUTOCOMPACT = truthy("NIKCLI_DISABLE_AUTOCOMPACT")
  // Opt out of the in-process config hot reload (instance reload on config
  // file changes). Reload can still be triggered explicitly via the API.
  export const NIKCLI_DISABLE_HOT_RELOAD = truthy("NIKCLI_DISABLE_HOT_RELOAD")
  // Opt out of journaling local (non-workspace) session restore events into
  // the unified sync_event log.
  export const NIKCLI_DISABLE_SESSION_JOURNAL = truthy("NIKCLI_DISABLE_SESSION_JOURNAL")
  // Optional hub-and-spoke remote sync. Setting both URL and TOKEN enables
  // it; AUTOSTART=false keeps bootstrap from starting it automatically
  // (explicit `nikcli sync` / `nikcli serve` still can).
  export const NIKCLI_REMOTE_URL = process.env["NIKCLI_REMOTE_URL"]
  export const NIKCLI_REMOTE_TOKEN = process.env["NIKCLI_REMOTE_TOKEN"]
  export const NIKCLI_REMOTE_AUTOSTART = (() => {
    const value = process.env["NIKCLI_REMOTE_AUTOSTART"]?.toLowerCase()
    return value !== "false" && value !== "0"
  })()
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
  // Max HTTP request body in bytes (defaults applied at the serve site). Lets
  // large teleport uploads through Bun's 128MB default when needed.
  export const NIKCLI_SERVER_MAX_BODY = process.env["NIKCLI_SERVER_MAX_BODY"]
    ? parseInt(process.env["NIKCLI_SERVER_MAX_BODY"]!, 10)
    : undefined
  export const NIKCLI_SERVER_TAILSCALE_AUTH = truthy("NIKCLI_SERVER_TAILSCALE_AUTH")
  export const NIKCLI_SERVER_TAILSCALE_USERS = process.env["NIKCLI_SERVER_TAILSCALE_USERS"]
  export const NIKCLI_AUTH_ISSUER = process.env["NIKCLI_AUTH_ISSUER"]
  export const NIKCLI_AUTH_JWKS_URL = process.env["NIKCLI_AUTH_JWKS_URL"]
  export const NIKCLI_AUTH_AUDIENCE = process.env["NIKCLI_AUTH_AUDIENCE"] ?? "nikcli-api"
  export const NIKCLI_AUTH_JWT_SECRET = process.env["NIKCLI_AUTH_JWT_SECRET"]
  export const NIKCLI_REQUIRE_OAUTH = truthy("NIKCLI_REQUIRE_OAUTH")
  export const NIKCLI_LEGACY_LOGIN = truthy("NIKCLI_LEGACY_LOGIN")

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
  // Confined code-mode tool (interpreter port from opencode v2 codemode); see specs/codemode.md.
  // Default-on; opt out with NIKCLI_DISABLE_CODE_MODE.
  export const NIKCLI_EXPERIMENTAL_CODE_MODE = !truthy("NIKCLI_DISABLE_CODE_MODE")

  // Computer & browser use ("computer use" like Codex / Claude Code).
  // Browser tasks run through Browser Use SDK v3; desktop computer-use sends
  // real input to the local machine. Both tools remain explicitly disableable.
  // Opt out with NIKCLI_DISABLE_BROWSER_TOOL / NIKCLI_DISABLE_COMPUTER_TOOL.
  export const NIKCLI_EXPERIMENTAL_BROWSER_TOOL = !truthy("NIKCLI_DISABLE_BROWSER_TOOL")
  export const NIKCLI_EXPERIMENTAL_COMPUTER_TOOL = !truthy("NIKCLI_DISABLE_COMPUTER_TOOL")

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

Object.defineProperty(Flag, "NIKCLI_ISLAND", {
  get() {
    return truthy("NIKCLI_ISLAND")
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
    // Default on (2026-07-08 — misty-moon wave 4 flip-all). Set to "0"/"false"
    // to opt out and fall back to pure Hono.
    if (process.env["NIKCLI_EXPERIMENTAL_HTTPAPI"] === undefined) return true
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
