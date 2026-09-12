import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["remote"].commands["status"], async (input) => {
  const { RemoteStatusCommand } = await import("@/cli/cmd/remote")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "json": Option.getOrUndefined(input["json"]),
  }
  await RemoteStatusCommand.handler(args)
})
