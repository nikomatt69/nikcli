import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["auth"].commands["logout"], async (input) => {
  const { AuthLogoutCommand } = await import("@/cli/cmd/auth")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
  }
  await AuthLogoutCommand.handler(args)
})
