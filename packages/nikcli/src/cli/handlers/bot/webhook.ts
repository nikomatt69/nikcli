import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["bot"].commands["webhook"], async (input) => {
  const { BotWebhookCommand } = await import("@/cli/cmd/chatbot")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "name": Option.getOrUndefined(input["name"]),
  }
  await BotWebhookCommand.handler(args)
})
