import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["ads"].commands["disable"], async (input) => {
  const { AdsDisableCommand } = await import("@/cli/cmd/ads")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
  }
  await AdsDisableCommand.handler(args)
})
