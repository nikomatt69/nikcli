import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { passthrough } from "../framework/args"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["goal"], async (input) => {
  const { GoalCommand } = await import("@/cli/cmd/goal")
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
  await GoalCommand.handler(args)
})
