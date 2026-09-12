import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { delegate } from "../framework/yargs-bridge"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["teleport"], (input) =>
  delegate(() => import("@/cli/cmd/teleport"), "TeleportCommand", [] as string[], {
    "sessionID": Option.getOrUndefined(input["sessionID"]),
    "url": Option.getOrUndefined(input["url"]),
    "token": Option.getOrUndefined(input["token"]),
    "content": input["content"],
    "git": input["git"],
    "save": input["save"],
  }),
)
