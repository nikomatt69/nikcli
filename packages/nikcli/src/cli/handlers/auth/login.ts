import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["auth"].commands["login"], async (input) => {
  const { AuthLoginCommand } = await import("@/cli/cmd/auth")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "url": Option.getOrUndefined(input["url"]),
    "provider": input["provider"],
    "server": Option.getOrUndefined(input["server"]),
  }
  await AuthLoginCommand.handler(args)
})
