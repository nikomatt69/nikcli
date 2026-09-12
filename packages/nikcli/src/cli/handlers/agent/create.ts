import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["agent"].commands["create"], (input) =>
  delegate(() => import("@/cli/cmd/agent"), "AgentCommand", ["create"] as string[], {
    "path": Option.getOrUndefined(input["path"]),
    "description": Option.getOrUndefined(input["description"]),
    "mode": Option.getOrUndefined(input["mode"]),
    "tools": Option.getOrUndefined(input["tools"]),
    "model": Option.getOrUndefined(input["model"]),
  }),
)
