import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["mission"].commands["new"], (input) =>
  delegate(() => import("@/cli/cmd/mission"), "MissionCommand", ["new"] as string[], {
    "name": Option.getOrUndefined(input["name"]),
    "brief": Option.getOrUndefined(input["brief"]),
    "file": Option.getOrUndefined(input["file"]),
    "from-description": Option.getOrUndefined(input["from-description"]),
    "model": Option.getOrUndefined(input["model"]),
    "agent": Option.getOrUndefined(input["agent"]),
    "worker-model": Option.getOrUndefined(input["worker-model"]),
    "start": Option.getOrUndefined(input["start"]),
  }),
)
