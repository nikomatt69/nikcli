import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { passthrough } from "../framework/args"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["usage"], async (input) => {
  const { UsageCommand } = await import("@/cli/cmd/usage")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "days": input["days"],
    "top": input["top"],
    "models": input["models"],
    "project": Option.getOrUndefined(input["project"]),
    "no-chart": input["no-chart"],
    "noChart": input["no-chart"],
  }
  await UsageCommand.handler(args)
})
