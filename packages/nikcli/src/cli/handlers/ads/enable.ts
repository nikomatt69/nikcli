import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["ads"].commands["enable"], async (input) => {
  const { AdsEnableCommand } = await import("@/cli/cmd/ads")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
  }
  await AdsEnableCommand.handler(args)
})
