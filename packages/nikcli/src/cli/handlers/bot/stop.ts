import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["bot"].commands["stop"], async (input) => {
  const { BotStopCommand } = await import("@/cli/cmd/chatbot")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "name": Option.getOrUndefined(input["name"]),
  }
  await BotStopCommand.handler(args)
})
