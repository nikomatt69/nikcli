import { cmd } from "../cmd"
import { tui } from "./app"
import { TuiConfig } from "@/config/tui"
import { Instance } from "@/project/instance"

export const AttachCommand = cmd({
  command: "attach <url>",
  describe: "attach to a running nikcli server",
  builder: (yargs) =>
    yargs
      .positional("url", {
        type: "string",
        describe: "http://localhost:4096",
        demandOption: true,
      })
      .option("dir", {
        type: "string",
        description: "directory to run in",
      })
      .option("session", {
        alias: ["s"],
        type: "string",
        describe: "session id to continue",
      }),
  handler: async (args) => {
    if (args.dir) process.chdir(args.dir)
    const cwd = process.cwd()
    const config = await Instance.provide({
      directory: cwd,
      fn: () => TuiConfig.get(),
    }).catch(() => ({}) as TuiConfig.Info)
    await tui({
      url: args.url,
      args: { sessionID: args.session },
      config,
      directory: args.dir ? cwd : undefined,
    })
  },
})
