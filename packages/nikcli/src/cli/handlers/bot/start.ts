import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["bot"].commands["start"], (input) =>
  delegate(() => import("@/cli/cmd/chatbot"), "BotCommand", ["start"] as string[], {
    "name": Option.getOrUndefined(input["name"]),
  }),
)
