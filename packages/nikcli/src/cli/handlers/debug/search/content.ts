import { Option } from "effect"
import { Runtime } from "../../../framework/runtime"
import { passthrough } from "../../../framework/args"
import { Commands } from "../../../commands"

export default Runtime.handler(Commands.commands["debug"].commands["search"].commands["content"], async (input) => {
  const { ContentCommand } = await import("@/cli/cmd/debug/search")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "pattern": input["pattern"],
    "mode": input["mode"],
    "limit": Option.getOrUndefined(input["limit"]),
  }
  await ContentCommand.handler(args)
})
