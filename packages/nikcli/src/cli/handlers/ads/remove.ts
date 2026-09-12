import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["ads"].commands["remove"], async (input) => {
  const { AdsRemoveCommand } = await import("@/cli/cmd/ads")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "id": Option.getOrUndefined(input["id"]),
  }
  await AdsRemoveCommand.handler(args)
})
