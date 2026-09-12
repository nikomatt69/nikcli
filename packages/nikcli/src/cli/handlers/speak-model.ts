import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { delegate } from "../framework/yargs-bridge"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["speak-model"], (input) =>
  delegate(() => import("@/cli/cmd/speak-model"), "SpeakModelCommand", [] as string[], {
    "provider": Option.getOrUndefined(input["provider"]),
    "model": Option.getOrUndefined(input["model"]),
    "reset": input["reset"],
    "global": input["global"],
  }),
)
