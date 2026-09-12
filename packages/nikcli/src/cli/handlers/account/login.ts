import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["account"].commands["login"], async (input) => {
  const { AccountLoginCommand } = await import("@/cli/cmd/account")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "server": Option.getOrUndefined(input["server"]),
  }
  await AccountLoginCommand.handler(args)
})
