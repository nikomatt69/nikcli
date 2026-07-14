import { cmd } from "../cmd"

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
    // Lazy: ./app pulls in TuiPluginRuntime, whose OpenTUI runtime Bun plugin
    // must not install during CLI startup (startup-graph rule; it also breaks
    // require() of not-yet-cached CJS deps once installed).
    const { tui } = await import("./app")
    await tui({
      url: args.url,
      args: { sessionID: args.session },
      directory: args.dir ? process.cwd() : undefined,
    })
  },
})
