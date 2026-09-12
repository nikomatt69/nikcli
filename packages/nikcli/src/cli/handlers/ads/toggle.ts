import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["ads"].commands["toggle"], async (input) => {
  const { AdsToggleCommand } = await import("@/cli/cmd/ads")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "id": Option.getOrUndefined(input["id"]),
  }
  await AdsToggleCommand.handler(args)
})
