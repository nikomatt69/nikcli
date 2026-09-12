import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["auth"].commands["list"], async (input) => {
  const { AuthListCommand } = await import("@/cli/cmd/auth")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
  }
  await AuthListCommand.handler(args)
})
