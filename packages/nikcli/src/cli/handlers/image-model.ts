import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { delegate } from "../framework/yargs-bridge"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["image-model"], (input) =>
  delegate(() => import("@/cli/cmd/image-model"), "ImageModelCommand", [] as string[], {
    "provider": Option.getOrUndefined(input["provider"]),
    "model": Option.getOrUndefined(input["model"]),
    "reset": input["reset"],
    "global": input["global"],
    "refresh": input["refresh"],
  }),
)
