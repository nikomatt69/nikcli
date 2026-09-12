import type { Argv } from "@/cli/cmd/argv"
import { cmd } from "./cmd"
import { UI } from "../ui"

/**
 * Manage the shared background service.
 *
 * The handlers import `@/service/service` lazily. This module is registered in
 * `cli-main`, so a static import would pull the service module — and through it
 * `Installation` and the global paths — into every nikcli start, including the
 * ones that never touch the service. See `specs/background-service.md`.
 */
async function service() {
  const { BackgroundService } = await import("@/service/service")
  return BackgroundService
}

export const StartCommand = cmd({
  command: "start",
  describe: "start the background service if it is not already running",
  builder: (yargs: Argv) => yargs,
  handler: async () => {
    const BackgroundService = await service()
    const registration = await BackgroundService.ensure()
    UI.println(`nikcli service running on ${registration.url} (pid ${registration.pid})`)
  },
})

export const StopCommand = cmd({
  command: "stop",
  describe: "stop the background service",
  builder: (yargs: Argv) => yargs,
  handler: async () => {
    const BackgroundService = await service()
    const stopped = await BackgroundService.stop()
    UI.println(stopped ? "nikcli service stopped" : "nikcli service was not running")
  },
})

export const RestartCommand = cmd({
  command: "restart",
  describe: "restart the background service",
  builder: (yargs: Argv) => yargs,
  handler: async () => {
    const BackgroundService = await service()
    await BackgroundService.stop()
    const registration = await BackgroundService.start()
    UI.println(`nikcli service running on ${registration.url} (pid ${registration.pid})`)
  },
})

export const StatusCommand = cmd({
  command: "status",
  describe: "show whether the background service is running",
  builder: (yargs: Argv) =>
    yargs.option("json", {
      type: "boolean",
      describe: "print the status as JSON",
      default: false,
    }),
  handler: async (args) => {
    const BackgroundService = await service()
    const status = await BackgroundService.status()
    if (args.json) {
      UI.println(JSON.stringify(status))
      return
    }
    if (!status.running || !status.registration) {
      UI.println(`nikcli service is not running (channel ${status.channel})`)
      return
    }
    const { registration } = status
    UI.println(`nikcli service running on ${registration.url}`)
    UI.println(`  channel  ${status.channel}`)
    UI.println(`  pid      ${registration.pid}`)
    UI.println(`  version  ${registration.version}${status.versionMatches ? "" : " (differs from this client)"}`)
    UI.println(`  started  ${new Date(registration.startedAt).toISOString()}`)
  },
})

async function config() {
  const { ServiceConfig } = await import("@/service/config")
  return ServiceConfig
}

export const GetCommand = cmd({
  command: "get [key]",
  describe: "show the service settings, or one of them",
  builder: (yargs: Argv) =>
    yargs.positional("key", { type: "string", describe: "hostname | port | cors | env" }),
  handler: async (args) => {
    const ServiceConfig = await config()
    const value = await ServiceConfig.get(args.key)
    UI.println(value === undefined ? "" : JSON.stringify(value, null, 2))
  },
})

export const SetCommand = cmd({
  command: "set <key> <value> [nested]",
  describe: "change a service setting and stop the running service",
  builder: (yargs: Argv) =>
    yargs
      .positional("key", { type: "string", demandOption: true, describe: "hostname | port | cors | env" })
      .positional("value", { type: "string", demandOption: true, describe: "the value, or the env var name" })
      .positional("nested", { type: "string", describe: "the env var value, for `set env <name> <value>`" }),
  handler: async (args) => {
    const ServiceConfig = await config()
    await ServiceConfig.set(args.key as string, args.value as string, args.nested as string | undefined)
    UI.println(`set ${args.key}; the service will pick it up on its next start`)
  },
})

export const UnsetCommand = cmd({
  command: "unset <key> [nested]",
  describe: "clear a service setting and stop the running service",
  builder: (yargs: Argv) =>
    yargs
      .positional("key", { type: "string", demandOption: true, describe: "hostname | port | cors | env" })
      .positional("nested", { type: "string", describe: "the env var name, for `unset env <name>`" }),
  handler: async (args) => {
    const ServiceConfig = await config()
    await ServiceConfig.unset(args.key as string, args.nested as string | undefined)
    UI.println(`unset ${args.key}; the service will pick it up on its next start`)
  },
})

export const ServiceCommand = cmd({
  command: "service",
  describe: "manage the shared background nikcli service",
  builder: (yargs: Argv) =>
    yargs
      .command(StartCommand)
      .command(StopCommand)
      .command(RestartCommand)
      .command(StatusCommand)
      .command(GetCommand)
      .command(SetCommand)
      .command(UnsetCommand)
      .demandCommand(),
  async handler() {},
})
