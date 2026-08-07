import type { Argv } from "yargs"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { Installation } from "../../installation"
import { runPromiseWithLayer } from "@/effect"
import { Effect } from "effect"
import { TERMINAL_RESET_SEQUENCE } from "@/cli/cmd/tui/win32"

function runInstallation<A, E>(effect: Effect.Effect<A, E, Installation.Service>) {
  return runPromiseWithLayer(Installation.defaultLayer, effect)
}

export const UpgradeCommand = {
  command: "upgrade [target]",
  describe: "upgrade nikcli to the latest or a specific version",
  builder: (yargs: Argv) => {
    return yargs
      .positional("target", {
        describe: "version to upgrade to, for ex '0.1.48' or 'v0.1.48'",
        type: "string",
      })
      .option("method", {
        alias: "m",
        describe: "installation method to use",
        type: "string",
        choices: ["curl", "npm", "yarn", "pnpm", "bun", "brew", "choco", "scoop"],
      })
  },
  handler: async (args: { target?: string; method?: string }) => {
    // The build being replaced may have leaked mouse reporting into the
    // terminal on exit, which turns every mouse move during the upgrade into
    // visible escape-sequence noise. Clear it before printing anything.
    if (process.stdout.isTTY) process.stdout.write(TERMINAL_RESET_SEQUENCE)
    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()
    prompts.intro("Upgrade")
    const detectedMethod = await runInstallation(
      Effect.gen(function* () {
        const installation = yield* Installation.Service
        return yield* installation.method()
      }),
    )
    const method = (args.method as Installation.Method) ?? detectedMethod
    if (method === "unknown") {
      prompts.log.error(`nikcli is installed to ${process.execPath} and may be managed by a package manager`)
      const install = await prompts.select({
        message: "Install anyways?",
        options: [
          { label: "Yes", value: true },
          { label: "No", value: false },
        ],
        initialValue: false,
      })
      if (!install) {
        prompts.outro("Done")
        return
      }
    }
    prompts.log.info("Using method: " + method)
    const target = args.target
      ? args.target.replace(/^v/, "")
      : await runInstallation(
          Effect.gen(function* () {
            const installation = yield* Installation.Service
            return yield* installation.latest()
          }),
        )

    if (Installation.VERSION === target) {
      prompts.log.warn(`nikcli upgrade skipped: ${target} is already installed`)
      prompts.outro("Done")
      return
    }

    prompts.log.info(`From ${Installation.VERSION} → ${target}`)
    const spinner = prompts.spinner()
    spinner.start("Upgrading...")
    const err = await runInstallation(
      Effect.gen(function* () {
        const installation = yield* Installation.Service
        return yield* installation.upgrade(method, target)
      }),
    ).catch((err) => err)
    if (err) {
      spinner.stop("Upgrade failed", 1)
      if (err instanceof Installation.UpgradeFailedError) {
        if (method === "choco" && err.stderr.includes("not running from an elevated command shell")) {
          prompts.log.error("Please run the terminal as Administrator and try again")
        } else {
          prompts.log.error(err.stderr)
        }
      } else if (err instanceof Error) prompts.log.error(err.message)
      prompts.outro("Done")
      process.exit(1)
    }
    // The Windows installer cannot overwrite the binary that is running this
    // command, so it stages the new one and swaps it in once this process
    // exits. Saying "complete" there would be a lie until then.
    if (Installation.resolveUpgradeStrategy(method).type === "windows-installer") {
      spinner.stop("Upgrade staged")
      prompts.log.info(`nikcli ${target} will be in place once this command exits. Open a new terminal to use it.`)
    } else {
      spinner.stop("Upgrade complete")
    }
    prompts.outro("Done")
  },
}
