import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { passthrough } from "../framework/args"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["stats"], async (input) => {
  const { StatsCommand } = await import("@/cli/cmd/stats")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "days": Option.getOrUndefined(input["days"]),
    "tools": Option.getOrUndefined(input["tools"]),
    "models": Option.getOrUndefined(input["models"]),
    "project": Option.getOrUndefined(input["project"]),
  }
  await StatsCommand.handler(args)
})
