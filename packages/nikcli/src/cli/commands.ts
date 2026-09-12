import type { CommandModule } from "yargs"
import { lazyCmd } from "./cmd/lazy"

/**
 * Every CLI command, in the order they appear in `nikcli --help`.
 *
 * The list is deliberately the only place `cli-main.ts` touches a command: the
 * implementations load on demand (see `./cmd/lazy`), so adding a command here
 * costs help text and nothing else until someone runs it.
 *
 * `test/cli/lazy-commands.test.ts` checks this table against the modules it
 * points at — both that the metadata matches and that no implementation is
 * missing from the list.
 */
export const Commands: CommandModule<any, any>[] = [
  lazyCmd(
    { command: "acp", describe: "start ACP (Agent Client Protocol) server" },
    async () => (await import("./cmd/acp")).AcpCommand,
  ),
  lazyCmd(
    { command: "mcp", describe: "manage MCP (Model Context Protocol) servers" },
    async () => (await import("./cmd/mcp")).McpCommand,
  ),
  lazyCmd({ command: "ads", describe: "manage ads" }, async () => (await import("./cmd/ads")).AdsCommand),
  lazyCmd(
    { command: "$0 [project]", describe: "start nikcli tui" },
    async () => (await import("./cmd/tui/thread")).TuiThreadCommand,
  ),
  lazyCmd(
    { command: "attach <url>", describe: "attach to a running nikcli server" },
    async () => (await import("./cmd/tui/attach")).AttachCommand,
  ),
  lazyCmd(
    { command: "run [message..]", describe: "run nikcli with a message" },
    async () => (await import("./cmd/run")).RunCommand,
  ),
  lazyCmd(
    { command: "goal [condition..]", describe: "work autonomously until a verifiable goal condition is met" },
    async () => (await import("./cmd/goal")).GoalCommand,
  ),
  lazyCmd(
    { command: "analytics <subcommand>", describe: "inspect and publish local usage rollups" },
    async () => (await import("./cmd/analytics")).AnalyticsCommand,
  ),
  lazyCmd({ command: "generate" }, async () => (await import("./cmd/generate")).GenerateCommand),
  lazyCmd(
    { command: "api [request..]", describe: "call one endpoint of the HTTP contract" },
    async () => (await import("./cmd/api")).ApiCommand,
  ),
  lazyCmd(
    { command: "debug", describe: "debugging and troubleshooting tools" },
    async () => (await import("./cmd/debug")).DebugCommand,
  ),
  lazyCmd({ command: "auth", describe: "manage credentials" }, async () => (await import("./cmd/auth")).AuthCommand),
  lazyCmd(
    { command: "account", describe: "manage accounts" },
    async () => (await import("./cmd/account")).AccountCommand,
  ),
  lazyCmd(
    { command: "artifact", describe: "manage published artifacts (nikcli.store/artifact)" },
    async () => (await import("./cmd/artifact")).ArtifactCommand,
  ),
  lazyCmd({ command: "agent", describe: "manage agents" }, async () => (await import("./cmd/agent")).AgentCommand),
  lazyCmd(
    { command: "upgrade [target]", describe: "upgrade nikcli to the latest or a specific version" },
    async () => (await import("./cmd/upgrade")).UpgradeCommand,
  ),
  lazyCmd(
    { command: "quickstart", describe: "interactive walkthrough for first-time nikcli users" },
    async () => (await import("./cmd/quickstart")).QuickstartCommand,
  ),
  lazyCmd(
    { command: "doctor", describe: "diagnose common nikcli setup issues" },
    async () => (await import("./cmd/doctor")).DoctorCommand,
  ),
  lazyCmd(
    { command: "uninstall", describe: "uninstall nikcli and remove all related files" },
    async () => (await import("./cmd/uninstall")).UninstallCommand,
  ),
  lazyCmd(
    { command: "serve", describe: "starts a headless nikcli server" },
    async () => (await import("./cmd/serve")).ServeCommand,
  ),
  lazyCmd(
    { command: "workspace-serve", describe: "starts a remote workspace event server" },
    async () => (await import("./cmd/workspace-serve")).WorkspaceServeCommand,
  ),
  lazyCmd(
    { command: "web", describe: "start nikcli server and open web interface" },
    async () => (await import("./cmd/web")).WebCommand,
  ),
  lazyCmd(
    { command: "heap", describe: "show heap and process memory metrics" },
    async () => (await import("./cmd/heap")).HeapCommand,
  ),
  lazyCmd(
    { command: "models [provider]", describe: "list all available models" },
    async () => (await import("./cmd/models")).ModelsCommand,
  ),
  lazyCmd(
    { command: "locale [action]", describe: "show or set the CLI language, region, and the model's reply language" },
    async () => (await import("./cmd/locale")).LocaleCommand,
  ),
  lazyCmd(
    { command: "stats", describe: "show token usage and cost statistics" },
    async () => (await import("./cmd/stats")).StatsCommand,
  ),
  lazyCmd(
    { command: "export [sessionID]", describe: "export session data as JSON" },
    async () => (await import("./cmd/export")).ExportCommand,
  ),
  lazyCmd(
    { command: "import <file>", describe: "import session data from JSON file or URL" },
    async () => (await import("./cmd/import")).ImportCommand,
  ),
  lazyCmd(
    { command: "github", describe: "manage GitHub agent" },
    async () => (await import("./cmd/github")).GithubCommand,
  ),
  lazyCmd(
    { command: "pr <number>", describe: "fetch and checkout a GitHub PR branch, then run nikcli" },
    async () => (await import("./cmd/pr")).PrCommand,
  ),
  lazyCmd(
    { command: "session", describe: "manage sessions" },
    async () => (await import("./cmd/session")).SessionCommand,
  ),
  lazyCmd(
    { command: "image-model [provider] [model]", describe: "list or set image generation models" },
    async () => (await import("./cmd/image-model")).ImageModelCommand,
  ),
  lazyCmd(
    { command: "speak-model [provider] [model]", describe: "list or set TTS (speak) models" },
    async () => (await import("./cmd/speak-model")).SpeakModelCommand,
  ),
  lazyCmd(
    { command: "brain-model [model]", describe: "list or set the model used by Brain memory consolidation" },
    async () => (await import("./cmd/brain-model")).BrainModelCommand,
  ),
  lazyCmd(
    { command: "remote [command]", describe: "manage terminal and mobile app remote control sessions" },
    async () => (await import("./cmd/remote")).RemoteCommand,
  ),
  lazyCmd(
    {
      command: "teleport [sessionID]",
      describe: "teleport a session to a remote nikcli server to continue it from mobile",
    },
    async () => (await import("./cmd/teleport")).TeleportCommand,
  ),
  lazyCmd(
    { command: "companion", describe: "Web UI for nikcli sessions" },
    async () => (await import("./cmd/companion")).CompanionCommand,
  ),
  lazyCmd(
    { command: "mobile", describe: "mobile app host and pairing tools" },
    async () => (await import("./cmd/mobile")).MobileCommand,
  ),
  lazyCmd(
    { command: "routine", describe: "manage routines — scheduled and API-triggered AI workflows" },
    async () => (await import("./cmd/routine")).RoutineCommand,
  ),
  lazyCmd(
    { command: "mission", describe: "manage Missions — multi-milestone autonomous workflows" },
    async () => (await import("./cmd/mission")).MissionCommand,
  ),
  lazyCmd(
    { command: "usage", describe: "show token usage with charts and visual breakdowns" },
    async () => (await import("./cmd/usage")).UsageCommand,
  ),
  lazyCmd(
    { command: "plugin <module>", describe: "install plugin and update config", aliases: ["plug"] },
    async () => (await import("./cmd/plug")).PluginCommand,
  ),
  lazyCmd(
    { command: "sync", describe: "manage optional remote hub sync (e.g. https://s.nikcli.store)" },
    async () => (await import("./cmd/sync")).SyncCommand,
  ),
  lazyCmd(
    { command: "connectors", describe: "manage external service connectors (Figma, Slack, GitHub, Lovable)" },
    async () => (await import("./cmd/connectors")).ConnectorsCommand,
  ),
  lazyCmd(
    { command: "bot", describe: "manage chat bots (Discord, Slack, Teams, Google Chat, Linear, GitHub)" },
    async () => (await import("./cmd/chatbot")).BotCommand,
  ),
]
