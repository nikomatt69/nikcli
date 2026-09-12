import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["bot"].commands["start"], async (input) => {
  const { BotStartCommand } = await import("@/cli/cmd/chatbot")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "name": Option.getOrUndefined(input["name"]),
  }
  await BotStartCommand.handler(args)
})
