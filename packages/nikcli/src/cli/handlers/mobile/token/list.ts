import { Runtime } from "../../../framework/runtime"
import { passthrough } from "../../../framework/args"
import { Commands } from "../../../commands"

export default Runtime.handler(Commands.commands["mobile"].commands["token"].commands["list"], async (input) => {
  const { MobileTokenListCommand } = await import("@/cli/cmd/mobile")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
  }
  await MobileTokenListCommand.handler(args)
})
