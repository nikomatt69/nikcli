import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["account"].commands["logout"], async (input) => {
  const { AccountLogoutCommand } = await import("@/cli/cmd/account")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "account-id": Option.getOrUndefined(input["account-id"]),
    "accountId": Option.getOrUndefined(input["account-id"]),
  }
  await AccountLogoutCommand.handler(args)
})
