import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { passthrough } from "../framework/args"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["upgrade"], async (input) => {
  const { UpgradeCommand } = await import("@/cli/cmd/upgrade")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "target": Option.getOrUndefined(input["target"]),
    "method": Option.getOrUndefined(input["method"]),
  }
  await UpgradeCommand.handler(args)
})
