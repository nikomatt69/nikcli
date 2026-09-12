import { Option } from "effect"
import { Runtime } from "../../../framework/runtime"
import { passthrough } from "../../../framework/args"
import { Commands } from "../../../commands"

export default Runtime.handler(Commands.commands["debug"].commands["search"].commands["tree"], async (input) => {
  const { TreeCommand } = await import("@/cli/cmd/debug/search")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "limit": Option.getOrUndefined(input["limit"]),
  }
  await TreeCommand.handler(args)
})
