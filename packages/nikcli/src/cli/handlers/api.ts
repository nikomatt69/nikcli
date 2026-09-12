import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { delegate } from "../framework/yargs-bridge"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["api"], (input) =>
  delegate(() => import("@/cli/cmd/api"), "ApiCommand", [] as string[], {
    "request": input["request"],
    "data": Option.getOrUndefined(input["data"]),
    "param": input["param"],
    "header": input["header"],
    "list": Option.getOrUndefined(input["list"]),
    "directory": Option.getOrUndefined(input["directory"]),
  }),
)
