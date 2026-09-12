import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { passthrough } from "../framework/args"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["teleport"], async (input) => {
  const { TeleportCommand } = await import("@/cli/cmd/teleport")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "sessionID": Option.getOrUndefined(input["sessionID"]),
    "url": Option.getOrUndefined(input["url"]),
    "token": Option.getOrUndefined(input["token"]),
    "content": input["content"],
    "git": input["git"],
    "save": input["save"],
  }
  await TeleportCommand.handler(args)
})
