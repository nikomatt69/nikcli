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
import { Log } from "@nikcli-ai/util/log"
import { Commands } from "./cli/commands"
// `./cli/logo` rather than `./cli/ui`, whose `logo()` is a pass-through to it:
// UI additionally pulls in effect's Schema and the remote-tunnel service, which
// this entry needs only on the error path below. It loads there instead.
import { logo } from "./cli/logo"
import { Installation } from "./installation"
import { initialize } from "@nikcli-ai/util/global"
import { FormatError } from "@nikcli-ai/util/cli-error"
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
    .usage("\n" + logo())
    .completion("completion", "generate shell completion script")
    .command(Commands)
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
    // Loaded here, not at module scope: this is the one path that needs UI's
    // styled output, and the process is on its way out anyway.
    const { UI } = await import("./cli/ui")
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
