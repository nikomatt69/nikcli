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
      .option("token-budget", {
        type: "number",
        describe: "optional token budget for automatic goal continuation",
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

    const tokenBudget = args.tokenBudget ?? args["token-budget"]
    let message = condition
    if (tokenBudget !== undefined) {
      if (typeof tokenBudget !== "number" || !Number.isSafeInteger(tokenBudget) || tokenBudget <= 0) {
        console.error("--token-budget must be a positive integer")
        process.exit(1)
      }
      message = `--token-budget ${tokenBudget} ${condition}`
    }

    await RunCommand.handler({
      ...args,
      command: "goal",
      message: [message],
    } as never)
  },
})
