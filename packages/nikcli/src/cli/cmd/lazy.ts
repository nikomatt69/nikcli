import type { CommandModule } from "yargs"

/**
 * Lazy command registration.
 *
 * Importing a command module pulls its entire backend graph (Server, Provider,
 * Agent, Storage, effect, provider SDKs, …) at top level. The entrypoint
 * registers ~40 commands, so launching the default TUI used to evaluate nearly
 * the whole backend up front — even though the TUI talks to a backend that runs
 * in a separate worker and never executes those command bodies.
 *
 * Each spec below carries only the static metadata yargs needs to build the
 * top-level help and route a command (`command`, `describe`, `aliases`). The
 * real module is `import()`-ed lazily the first time the command's builder or
 * handler runs — i.e. only when that command is actually invoked. See
 * specs/tui-startup-speed.md.
 *
 * The static metadata is kept honest by test/cli/lazy-commands.test.ts, which
 * imports every module and asserts the table matches the real command objects.
 */
export interface LazyCommandSpec {
  /** yargs command string, e.g. "run [message..]". Must match the module. */
  command: string
  /** Help text. `undefined` keeps a command visible but undescribed (parity). */
  describe?: string | false
  /** Static aliases — required up front so yargs can route them. */
  aliases?: readonly string[]
  /** Named export to read from the loaded module, e.g. "RunCommand". */
  export: string
  /** Lazy module loader. Use a static string literal so the bundler can split it. */
  load: () => Promise<Record<string, unknown>>
}

async function resolve(spec: LazyCommandSpec): Promise<CommandModule<any, any>> {
  const mod = await spec.load()
  const command = mod[spec.export] as CommandModule<any, any> | undefined
  if (!command) {
    throw new Error(`lazy command "${spec.command}" is missing export "${spec.export}"`)
  }
  return command
}

/** Wrap a {@link LazyCommandSpec} as a yargs CommandModule with deferred loading. */
export function lazyCommand(spec: LazyCommandSpec): CommandModule<any, any> {
  return {
    command: spec.command,
    describe: spec.describe,
    ...(spec.aliases ? { aliases: [...spec.aliases] } : {}),
    // yargs@18 awaits async builders before validating args / rendering
    // `<cmd> --help`, so deferring the import here is safe under `.strict()`.
    builder: async (yargs) => {
      const command = await resolve(spec)
      const builder = command.builder
      if (typeof builder === "function") return await builder(yargs)
      if (builder && typeof builder === "object") return yargs.options(builder)
      return yargs
    },
    handler: async (args) => {
      const command = await resolve(spec)
      return command.handler(args)
    },
  }
}

/**
 * Every non-default command, registered lazily. The default `$0` TUI command
 * (TuiThreadCommand) stays eagerly imported in the entrypoint: it is the common
 * path, so deferring it would buy nothing.
 */
export const LAZY_COMMANDS: readonly LazyCommandSpec[] = [
  { export: "AcpCommand", command: "acp", describe: "start ACP (Agent Client Protocol) server", load: () => import("./acp") },
  { export: "McpCommand", command: "mcp", describe: "manage MCP (Model Context Protocol) servers", load: () => import("./mcp") },
  { export: "AdsCommand", command: "ads", describe: "manage ads", load: () => import("./ads") },
  { export: "AttachCommand", command: "attach <url>", describe: "attach to a running nikcli server", load: () => import("./tui/attach") },
  { export: "RunCommand", command: "run [message..]", describe: "run nikcli with a message", load: () => import("./run") },
  { export: "GoalCommand", command: "goal [condition..]", describe: "work autonomously until a verifiable goal condition is met", load: () => import("./goal") },
  { export: "GenerateCommand", command: "generate", describe: undefined, load: () => import("./generate") },
  { export: "DebugCommand", command: "debug", describe: "debugging and troubleshooting tools", load: () => import("./debug") },
  { export: "AuthCommand", command: "auth", describe: "manage credentials", load: () => import("./auth") },
  { export: "AccountCommand", command: "account", describe: "manage accounts", load: () => import("./account") },
  { export: "AgentCommand", command: "agent", describe: "manage agents", load: () => import("./agent") },
  { export: "UpgradeCommand", command: "upgrade [target]", describe: "upgrade nikcli to the latest or a specific version", load: () => import("./upgrade") },
  { export: "QuickstartCommand", command: "quickstart", describe: "interactive walkthrough for first-time nikcli users", load: () => import("./quickstart") },
  { export: "DoctorCommand", command: "doctor", describe: "diagnose common nikcli setup issues", load: () => import("./doctor") },
  { export: "UninstallCommand", command: "uninstall", describe: "uninstall nikcli and remove all related files", load: () => import("./uninstall") },
  { export: "ServeCommand", command: "serve", describe: "starts a headless nikcli server", load: () => import("./serve") },
  { export: "WorkspaceServeCommand", command: "workspace-serve", describe: "starts a remote workspace event server", load: () => import("./workspace-serve") },
  { export: "WebCommand", command: "web", describe: "start nikcli server and open web interface", load: () => import("./web") },
  { export: "HeapCommand", command: "heap", describe: "show heap and process memory metrics", load: () => import("./heap") },
  { export: "ModelsCommand", command: "models [provider]", describe: "list all available models", load: () => import("./models") },
  { export: "LocaleCommand", command: "locale [action]", describe: "show or set the CLI language, region, and the model's reply language", load: () => import("./locale") },
  { export: "StatsCommand", command: "stats", describe: "show token usage and cost statistics", load: () => import("./stats") },
  { export: "ExportCommand", command: "export [sessionID]", describe: "export session data as JSON", load: () => import("./export") },
  { export: "ImportCommand", command: "import <file>", describe: "import session data from JSON file or URL", load: () => import("./import") },
  { export: "GithubCommand", command: "github", describe: "manage GitHub agent", load: () => import("./github") },
  { export: "PrCommand", command: "pr <number>", describe: "fetch and checkout a GitHub PR branch, then run nikcli", load: () => import("./pr") },
  { export: "SessionCommand", command: "session", describe: "manage sessions", load: () => import("./session") },
  { export: "ImageModelCommand", command: "image-model [provider] [model]", describe: "list or set image generation models", load: () => import("./image-model") },
  { export: "SpeakModelCommand", command: "speak-model [provider] [model]", describe: "list or set TTS (speak) models", load: () => import("./speak-model") },
  { export: "BrainModelCommand", command: "brain-model [model]", describe: "list or set the model used by Brain memory consolidation", load: () => import("./brain-model") },
  { export: "RemoteCommand", command: "remote [command]", describe: "manage terminal and mobile app remote control sessions", load: () => import("./remote") },
  { export: "TeleportCommand", command: "teleport [sessionID]", describe: "teleport a session to a remote nikcli server to continue it from mobile", load: () => import("./teleport") },
  { export: "CompanionCommand", command: "companion", describe: "Web UI for nikcli sessions", load: () => import("./companion") },
  { export: "MobileCommand", command: "mobile", describe: "mobile app host and pairing tools", load: () => import("./mobile") },
  { export: "RoutineCommand", command: "routine", describe: "manage routines — scheduled and API-triggered AI workflows", load: () => import("./routine") },
  { export: "UsageCommand", command: "usage", describe: "show token usage with charts and visual breakdowns", load: () => import("./usage") },
  { export: "MissionCommand", command: "mission", describe: "manage Missions — multi-milestone autonomous workflows", load: () => import("./mission") },
  { export: "PluginCommand", command: "plugin <module>", describe: "install plugin and update config", aliases: ["plug"], load: () => import("./plug") },
]
