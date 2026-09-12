import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { delegate } from "../framework/yargs-bridge"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["models"], (input) =>
  delegate(() => import("@/cli/cmd/models"), "ModelsCommand", [] as string[], {
    "provider": Option.getOrUndefined(input["provider"]),
    "verbose": Option.getOrUndefined(input["verbose"]),
    "refresh": Option.getOrUndefined(input["refresh"]),
  }),
)
