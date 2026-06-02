import type { Argv } from "yargs"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { spawn } from "bun"
import { cmd } from "./cmd"
import { EOL } from "os"

export const QuickstartCommand = cmd({
  command: "quickstart",
  describe: "interactive walkthrough for first-time nikcli users",
  builder: (yargs: Argv) =>
    yargs
      .option("skip-checks", {
        describe: "skip the connectivity and config checks",
        type: "boolean",
      })
      .option("dry-run", {
        describe: "print the next-step command without running it",
        type: "boolean",
      }),
  handler: async (args: { skipChecks?: boolean; dryRun?: boolean }) => {
    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()
    prompts.intro("Welcome to nikcli")

    prompts.log.step("This 60-second tour gets you from zero to your first useful response.")

    if (!args.skipChecks) {
      const connected = await probeConnectedProviders()
      if (connected === 0) {
        prompts.log.warn("No provider is connected yet (or the nikcli server is not running in this directory).")
        const action = await prompts.select({
          message: "How would you like to connect a provider?",
          options: [
            { label: "Run `nikcli auth login` now", value: "login" },
            { label: "Skip — I'll set it up later", value: "skip" },
            { label: "Show me the docs", value: "docs" },
          ],
          initialValue: "login",
        })
        if (prompts.isCancel(action)) {
          prompts.outro("Cancelled. Run `nikcli quickstart` again any time.")
          return
        }
        if (action === "login") {
          if (args.dryRun) {
            prompts.log.info("[dry-run] would exec: nikcli auth login")
            prompts.outro("Done.")
            return
          }
          prompts.log.info("Launching `nikcli auth login`…")
          prompts.outro("Re-run `nikcli quickstart` after you've connected a provider.")
          const code = await reexec(["auth", "login"])
          process.exit(code)
        }
        if (action === "docs") {
          prompts.log.info("Read https://nikcli.store/docs/quickstart for the full walkthrough.")
        }
      } else {
        prompts.log.success(`${connected} provider${connected === 1 ? "" : "s"} connected.`)
      }
    }

    const next = await prompts.select({
      message: "Pick a first action:",
      options: [
        { label: "Open the TUI", value: "tui" },
        { label: "Run a one-shot prompt", value: "run" },
        { label: "Browse available models", value: "models" },
        { label: "I'm done — just print the help", value: "done" },
      ],
      initialValue: "tui",
    })
    if (prompts.isCancel(next)) {
      prompts.outro("Cancelled.")
      return
    }

    const dryRun = args.dryRun
    switch (next) {
      case "tui":
        if (dryRun) {
          prompts.log.info("[dry-run] would exec: nikcli (open the TUI)")
          prompts.outro("Done.")
          return
        }
        prompts.log.info("Launching the TUI…")
        prompts.outro("Welcome!")
        const tuiCode = await reexec([])
        process.exit(tuiCode)
      case "run": {
        const promptText = await prompts.text({
          message: "What should nikcli do?",
          placeholder: "e.g. explain this codebase in 5 lines",
          validate: (v) => (v && v.trim().length === 0 ? "Please enter a prompt" : undefined),
        })
        if (prompts.isCancel(promptText)) {
          prompts.outro("Cancelled.")
          return
        }
        if (dryRun) {
          prompts.log.info(`[dry-run] would exec: nikcli run ${JSON.stringify(promptText)}`)
          prompts.outro("Done.")
          return
        }
        prompts.log.info(`Running one-shot prompt: ${promptText}`)
        const runCode = await reexec(["run", promptText])
        process.exit(runCode)
      }
      case "models":
        if (dryRun) {
          prompts.log.info("[dry-run] would exec: nikcli models")
          prompts.outro("Done.")
          return
        }
        prompts.outro("Listing available models…")
        const modelsCode = await reexec(["models"])
        process.exit(modelsCode)
      default:
        prompts.log.info("Help: `nikcli --help` lists every command.")
        prompts.log.info("Docs: https://nikcli.store/docs")
        prompts.log.info(`Docs path: ${process.cwd()}${EOL}`)
        prompts.outro("Done.")
    }
  },
})

/**
 * Re-exec the current nikcli binary with extra positional args appended after
 * the user's existing argv. Returns the child's exit code. Used by quickstart
 * to hand off to the TUI / `run` / `models` without duplicating their setup.
 */
async function reexec(extraArgs: string[]): Promise<number> {
  // Strip the `quickstart` and any quickstart-only flags from argv so the
  // child sees the same invocation the user typed.
  const filtered = process.argv.slice(2).filter((a) => !a.startsWith("--") || isAllowedFlag(a))
  const proc = spawn({
    cmd: [process.execPath, ...process.argv.slice(1, 2), ...filtered, ...extraArgs],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  })
  const code = await proc.exited
  return code
}

const ALLOWED_FLAGS = new Set(["--skip-checks", "--dry-run", "-h", "--help"])
function isAllowedFlag(arg: string): boolean {
  return ALLOWED_FLAGS.has(arg)
}

/**
 * Best-effort count of connected providers. Returns 0 on any failure (server
 * not running, no providers, etc.) so the rest of the quickstart still runs.
 */
async function probeConnectedProviders(): Promise<number> {
  try {
    const { Provider } = await import("../../provider/provider")
    const { runPromiseWithLayer, withCurrentInstance } = await import("../../effect/runtime")
    const { withInstanceAsync } = await import("../../effect/with-instance")
    const { Effect } = await import("effect")
    const providers: Record<string, unknown> = await withInstanceAsync({ directory: process.cwd() }, () =>
      runPromiseWithLayer(
        Provider.defaultLayer,
        withCurrentInstance(
          Effect.gen(function* () {
            const svc = yield* Provider.Service
            return yield* svc.list()
          }),
        ),
      ),
    )
    return Object.values(providers).filter((p) => {
      const models = (p as { models?: Record<string, unknown> }).models
      return models !== undefined && Object.keys(models).length > 0
    }).length
  } catch {
    return 0
  }
}
