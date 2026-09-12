import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { delegate } from "../framework/yargs-bridge"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["brain-model"], (input) =>
  delegate(() => import("@/cli/cmd/brain-model"), "BrainModelCommand", [] as string[], {
    "model": Option.getOrUndefined(input["model"]),
    "reset": input["reset"],
    "global": input["global"],
    "refresh": input["refresh"],
  }),
)
