import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { RunCommand } from "./run"

export const GoalCommand = cmd({
  command: "goal [condition..]",
  describe: "work autonomously until a verifiable goal condition is met",
  builder: (yargs: Argv) => {
    return yargs
      .positional("condition", {
        describe: "completion condition to satisfy",
        type: "string",
        array: true,
        default: [],
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        describe: "session id to continue",
        type: "string",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      })
      .option("variant", {
        type: "string",
        describe: "model variant (provider-specific reasoning effort, e.g., high, max, minimal)",
      })
      .option("format", {
        type: "string",
        choices: ["default", "json"],
        default: "default",
        describe: "format: default (formatted) or json (raw JSON events)",
      })
  },
  handler: async (args) => {
    const condition = [...args.condition, ...(args["--"] || [])].join(" ").trim()
    if (!condition) {
      console.error("You must provide a goal condition")
      process.exit(1)
    }

    await RunCommand.handler({
      ...args,
      command: "goal",
      message: [condition],
    } as never)
  },
})
