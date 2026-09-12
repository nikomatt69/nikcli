/**
 * Full CLI entry — loaded only when nikcli is not hosting an internal daemon.
 * Kept separate from `index.ts` so `--browser-control-daemon` /
 * `--computer-use-daemon` re-entry does not pay the CLI module graph before
 * binding the Unix socket.
 */
import { installPluginInstaller } from "./plugin/installer"
import yargs from "yargs"
import { hideBin } from "yargs/helpers"

// Every CLI command that can install a plugin runs through this entry.
installPluginInstaller()
import { GenerateCommand } from "./cli/cmd/generate"
import { Log } from "@nikcli-ai/util/log"
import { UI } from "./cli/ui"
import { Installation } from "./installation"
import { initialize } from "@nikcli-ai/util/global"
import { Diagnostics } from "./cli/diagnostics"
import { exported, lazy } from "./cli/cmd/lazy"
import { FormatError } from "@nikcli-ai/util/cli-error"
import { AttachCommand } from "./cli/cmd/tui/attach"
import { TuiThreadCommand } from "./cli/cmd/tui/thread"
import { EOL } from "os"



import { IslandBridge } from "@nikcli-ai/util/island-bridge"

export async function runCli() {
  process.on("unhandledRejection", (e) => {
    Log.Default.error("rejection", {
      e: e instanceof Error ? e.message : e,
    })
  })

  process.on("uncaughtException", (e) => {
    Log.Default.error("exception", {
      e: e instanceof Error ? e.message : e,
    })
  })

  // Ensure the process exits on terminal hangup (e.g. closing the terminal tab).
  // Without this, long-running commands like `serve` block on a never-resolving
  // promise and survive as orphaned processes.
  process.on("SIGHUP", () => process.exit())

  const cli = yargs(hideBin(process.argv))
    .parserConfiguration({ "populate--": true })
    .scriptName("nikcli")
    .wrap(100)
    .help("help", "show help")
    .alias("help", "h")
    .version("version", "show version number", Installation.VERSION)
    .alias("version", "v")
    .option("print-logs", {
      describe: "print logs to stderr",
      type: "boolean",
    })
    .option("log-level", {
      describe: "log level",
      type: "string",
      choices: ["DEBUG", "INFO", "WARN", "ERROR"],
    })
    .option("island", {
      describe: "enable the nikcli Island macOS companion app",
      type: "boolean",
      default: false,
    })
    .option("auto", {
      describe: "approve permission prompts automatically (explicit denials still apply)",
      type: "boolean",
      default: false,
    })
    // Two aliases rather than one flag: `--yolo` is what people type, and
    // `--dangerously-skip-permissions` is what a script should say so the intent is obvious in CI
    // logs and shell history.
    .option("yolo", {
      describe: "alias for --auto",
      type: "boolean",
      default: false,
    })
    .option("dangerously-skip-permissions", {
      describe: "alias for --auto",
      type: "boolean",
      default: false,
    })
    .middleware(async (opts) => {
      await initialize()
      // Armed after `initialize()` because the capture paths write into
      // `Global.Path.log`. See `cli/diagnostics.ts` for the two signals.
      Diagnostics.listen()
      process.env.NIKCLI_ISLAND = opts.island ? "1" : "0"
      // Passed through the environment because the TUI runs the session in a worker thread, which
      // never sees this argv.
      if (opts.auto || opts.yolo || opts["dangerously-skip-permissions"]) {
        process.env.NIKCLI_AUTO_APPROVE = "1"
      }
      // IslandBridge.start() itself is called from inside Bus.publish (src/bus/index.ts) —
      // the one choke point every session/permission/tool event already flows through in
      // any realm, so the enabled bridge self-activates without this entrypoint (or the
      // TUI's worker thread) needing to remember to call it. Only the cleanup half is wired per
      // entrypoint: safe here specifically because this is the plain (non-worker) case —
      // "this process" and "the OS process" are the same thing. The TUI's worker thread
      // (src/cli/cmd/tui/worker.ts) calls IslandBridge.stop() from its own shutdown
      // handler instead — see IslandBridge.stop()'s doc for why that distinction matters.
      process.on("exit", IslandBridge.stop)

      await Log.init({
        print: process.argv.includes("--print-logs"),
        dev: Installation.isLocal(),
        level: (() => {
          if (opts.logLevel) return opts.logLevel as Log.Level
          if (Installation.isLocal()) return "DEBUG"
          return "INFO"
        })(),
      })

      process.env.AGENT = "1"
      process.env.NIKCLI = "1"

      Log.Default.info("nikcli", {
        version: Installation.VERSION,
        args: process.argv.slice(2),
      })
    })
    .usage("\n" + UI.logo())
    .completion("completion", "generate shell completion script")
    .command(
      lazy(
        { command: "acp", describe: "start ACP (Agent Client Protocol) server" },
        exported(() => import("./cli/cmd/acp"), "AcpCommand"),
      ),
    )
    .command(
      lazy(
        { command: "mcp", describe: "manage MCP (Model Context Protocol) servers" },
        exported(() => import("./cli/cmd/mcp"), "McpCommand"),
      ),
    )
    .command(
      lazy(
        { command: "ads", describe: "manage ads" },
        exported(() => import("./cli/cmd/ads"), "AdsCommand"),
      ),
    )
    .command(TuiThreadCommand)
    .command(AttachCommand)
    .command(
      lazy(
        { command: "run [message..]", describe: "run nikcli with a message" },
        exported(() => import("./cli/cmd/run"), "RunCommand"),
      ),
    )
    .command(
      lazy(
        { command: "goal [condition..]", describe: "work autonomously until a verifiable goal condition is met" },
        exported(() => import("./cli/cmd/goal"), "GoalCommand"),
      ),
    )
    .command(
      lazy(
        { command: "analytics <subcommand>", describe: "inspect and publish local usage rollups" },
        exported(() => import("./cli/cmd/analytics"), "AnalyticsCommand"),
      ),
    )
    .command(GenerateCommand)
    .command(
      lazy(
        { command: "api [request..]", describe: "call one endpoint of the HTTP contract" },
        exported(() => import("./cli/cmd/api"), "ApiCommand"),
      ),
    )
    .command(
      lazy(
        { command: "debug", describe: "debugging and troubleshooting tools" },
        exported(() => import("./cli/cmd/debug"), "DebugCommand"),
      ),
    )
    .command(
      lazy(
        { command: "auth", describe: "manage credentials" },
        exported(() => import("./cli/cmd/auth"), "AuthCommand"),
      ),
    )
    .command(
      lazy(
        { command: "account", describe: "manage accounts" },
        exported(() => import("./cli/cmd/account"), "AccountCommand"),
      ),
    )
    .command(
      lazy(
        { command: "artifact", describe: "manage published artifacts (nikcli.store/artifact)" },
        exported(() => import("./cli/cmd/artifact"), "ArtifactCommand"),
      ),
    )
    .command(
      lazy(
        { command: "agent", describe: "manage agents" },
        exported(() => import("./cli/cmd/agent"), "AgentCommand"),
      ),
    )
    .command(
      lazy(
        { command: "upgrade [target]", describe: "upgrade nikcli to the latest or a specific version" },
        exported(() => import("./cli/cmd/upgrade"), "UpgradeCommand"),
      ),
    )
    .command(
      lazy(
        { command: "quickstart", describe: "interactive walkthrough for first-time nikcli users" },
        exported(() => import("./cli/cmd/quickstart"), "QuickstartCommand"),
      ),
    )
    .command(
      lazy(
        { command: "doctor", describe: "diagnose common nikcli setup issues" },
        exported(() => import("./cli/cmd/doctor"), "DoctorCommand"),
      ),
    )
    .command(
      lazy(
        { command: "uninstall", describe: "uninstall nikcli and remove all related files" },
        exported(() => import("./cli/cmd/uninstall"), "UninstallCommand"),
      ),
    )
    .command(
      lazy(
        { command: "serve", describe: "starts a headless nikcli server" },
        exported(() => import("./cli/cmd/serve"), "ServeCommand"),
      ),
    )
    .command(
      lazy(
        { command: "service", describe: "manage the shared background nikcli service" },
        exported(() => import("./cli/cmd/service"), "ServiceCommand"),
      ),
    )
    .command(
      lazy(
        { command: "workspace-serve", describe: "starts a remote workspace event server" },
        exported(() => import("./cli/cmd/workspace-serve"), "WorkspaceServeCommand"),
      ),
    )
    .command(
      lazy(
        { command: "web", describe: "start nikcli server and open web interface" },
        exported(() => import("./cli/cmd/web"), "WebCommand"),
      ),
    )
    .command(
      lazy(
        { command: "heap", describe: "show heap and process memory metrics" },
        exported(() => import("./cli/cmd/heap"), "HeapCommand"),
      ),
    )
    .command(
      lazy(
        { command: "models [provider]", describe: "list all available models" },
        exported(() => import("./cli/cmd/models"), "ModelsCommand"),
      ),
    )
    .command(
      lazy(
        { command: "locale [action]", describe: "show or set the CLI language, region, and the model's reply language" },
        exported(() => import("./cli/cmd/locale"), "LocaleCommand"),
      ),
    )
    .command(
      lazy(
        { command: "stats", describe: "show token usage and cost statistics" },
        exported(() => import("./cli/cmd/stats"), "StatsCommand"),
      ),
    )
    .command(
      lazy(
        { command: "export [sessionID]", describe: "export session data as JSON" },
        exported(() => import("./cli/cmd/export"), "ExportCommand"),
      ),
    )
    .command(
      lazy(
        { command: "import <file>", describe: "import session data from JSON file or URL" },
        exported(() => import("./cli/cmd/import"), "ImportCommand"),
      ),
    )
    .command(
      lazy(
        { command: "github", describe: "manage GitHub agent" },
        exported(() => import("./cli/cmd/github"), "GithubCommand"),
      ),
    )
    .command(
      lazy(
        { command: "pr <number>", describe: "fetch and checkout a GitHub PR branch, then run nikcli" },
        exported(() => import("./cli/cmd/pr"), "PrCommand"),
      ),
    )
    .command(
      lazy(
        { command: "session", describe: "manage sessions" },
        exported(() => import("./cli/cmd/session"), "SessionCommand"),
      ),
    )
    .command(
      lazy(
        { command: "image-model [provider] [model]", describe: "list or set image generation models" },
        exported(() => import("./cli/cmd/image-model"), "ImageModelCommand"),
      ),
    )
    .command(
      lazy(
        { command: "speak-model [provider] [model]", describe: "list or set TTS (speak) models" },
        exported(() => import("./cli/cmd/speak-model"), "SpeakModelCommand"),
      ),
    )
    .command(
      lazy(
        { command: "brain-model [model]", describe: "list or set the model used by Brain memory consolidation" },
        exported(() => import("./cli/cmd/brain-model"), "BrainModelCommand"),
      ),
    )
    .command(
      lazy(
        { command: "remote [command]", describe: "manage terminal and mobile app remote control sessions" },
        exported(() => import("./cli/cmd/remote"), "RemoteCommand"),
      ),
    )
    .command(
      lazy(
        { command: "teleport [sessionID]", describe: "teleport a session to a remote nikcli server to continue it from mobile" },
        exported(() => import("./cli/cmd/teleport"), "TeleportCommand"),
      ),
    )
    .command(
      lazy(
        { command: "companion", describe: "Web UI for nikcli sessions" },
        exported(() => import("./cli/cmd/companion"), "CompanionCommand"),
      ),
    )
    .command(
      lazy(
        { command: "mobile", describe: "mobile app host and pairing tools" },
        exported(() => import("./cli/cmd/mobile"), "MobileCommand"),
      ),
    )
    .command(
      lazy(
        { command: "routine", describe: "manage routines \u2014 scheduled and API-triggered AI workflows" },
        exported(() => import("./cli/cmd/routine"), "RoutineCommand"),
      ),
    )
    .command(
      lazy(
        { command: "mission", describe: "manage Missions \u2014 multi-milestone autonomous workflows" },
        exported(() => import("./cli/cmd/mission"), "MissionCommand"),
      ),
    )
    .command(
      lazy(
        { command: "usage", describe: "show token usage with charts and visual breakdowns" },
        exported(() => import("./cli/cmd/usage"), "UsageCommand"),
      ),
    )
    .command(
      lazy(
        { command: "plugin <module>", describe: "install plugin and update config" },
        exported(() => import("./cli/cmd/plug"), "PluginCommand"),
      ),
    )
    .command(
      lazy(
        { command: "sync", describe: "manage optional remote hub sync (e.g. https://s.nikcli.store)" },
        exported(() => import("./cli/cmd/sync"), "SyncCommand"),
      ),
    )
    .command(
      lazy(
        { command: "connectors", describe: "manage external service connectors (Figma, Slack, GitHub, Lovable)" },
        exported(() => import("./cli/cmd/connectors"), "ConnectorsCommand"),
      ),
    )
    .command(
      lazy(
        { command: "bot", describe: "manage chat bots (Discord, Slack, Teams, Google Chat, Linear, GitHub)" },
        exported(() => import("./cli/cmd/chatbot"), "BotCommand"),
      ),
    )
    .epilogue("nikcli is a fork of opencode (https://github.com/anomalyco/opencode) — credits to its authors.")
    .fail((msg, err) => {
      if (
        msg?.startsWith("Unknown argument") ||
        msg?.startsWith("Not enough non-option arguments") ||
        msg?.startsWith("Invalid values:")
      ) {
        if (err) throw err
        cli.showHelp("log")
      }
      if (err) throw err
      process.exit(1)
    })
    .strict()

  try {
    await cli.parse()
  } catch (e) {
    let data: Record<string, any> = {}
    if (e instanceof Error) {
      Object.assign(data, {
        name: e.name,
        message: e.message,
        cause: e.cause?.toString(),
        stack: e.stack,
      })
    }

    if (e instanceof ResolveMessage) {
      Object.assign(data, {
        name: e.name,
        message: e.message,
        code: e.code,
        specifier: e.specifier,
        referrer: e.referrer,
        position: e.position,
        importKind: e.importKind,
      })
    }
    Log.Default.error("fatal", data)
    const formatted = FormatError(e)
    if (formatted) UI.error(formatted)
    if (formatted === undefined) {
      UI.error("Unexpected error, check log file at " + Log.file() + " for more details" + EOL)
      console.error(e instanceof Error ? e.message : String(e))
    }
    process.exitCode = 1
  } finally {
    // Some subprocesses don't react properly to SIGTERM and similar signals.
    // Most notably, some docker-container-based MCP servers don't handle such signals unless
    // run using `docker run --init`.
    // Explicitly exit to avoid any hanging subprocesses.
    process.exit()
  }
}
