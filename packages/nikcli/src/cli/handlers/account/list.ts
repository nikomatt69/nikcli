import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["account"].commands["list"], async (input) => {
  const { AccountListCommand } = await import("@/cli/cmd/account")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
  }
  await AccountListCommand.handler(args)
})
