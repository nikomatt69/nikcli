import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { delegate } from "../../framework/yargs-bridge"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["routine"].commands["create"], (input) =>
  delegate(() => import("@/cli/cmd/routine"), "RoutineCommand", ["create"] as string[], {
    "name": Option.getOrUndefined(input["name"]),
    "prompt": Option.getOrUndefined(input["prompt"]),
    "cron": Option.getOrUndefined(input["cron"]),
    "api": Option.getOrUndefined(input["api"]),
    "api-token": Option.getOrUndefined(input["api-token"]),
  }),
)
