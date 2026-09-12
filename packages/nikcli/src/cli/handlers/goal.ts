import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { passthrough } from "../framework/args"
import { Commands } from "../commands"
import { runWithArgs } from "./run"

export default Runtime.handler(Commands.commands["goal"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "condition": input["condition"],
    "continue": Option.getOrUndefined(input["continue"]),
    "session": Option.getOrUndefined(input["session"]),
    "model": Option.getOrUndefined(input["model"]),
    "agent": Option.getOrUndefined(input["agent"]),
    "variant": Option.getOrUndefined(input["variant"]),
    "token-budget": Option.getOrUndefined(input["token-budget"]),
    "tokenBudget": Option.getOrUndefined(input["token-budget"]),
    "format": input["format"],
  }
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

  await runWithArgs({
    ...args,
    command: "goal",
    message: [message],
  })
})
