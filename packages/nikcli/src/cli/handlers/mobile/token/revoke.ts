import { Runtime } from "../../../framework/runtime"
import { passthrough } from "../../../framework/args"
import { Commands } from "../../../commands"

export default Runtime.handler(Commands.commands["mobile"].commands["token"].commands["revoke"], async (input) => {
  const { MobileTokenRevokeIdCommand } = await import("@/cli/cmd/mobile")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "id": input["id"],
  }
  await MobileTokenRevokeIdCommand.handler(args)
})
