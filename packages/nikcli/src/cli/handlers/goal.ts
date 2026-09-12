import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { delegate } from "../framework/yargs-bridge"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["goal"], (input) =>
  delegate(() => import("@/cli/cmd/goal"), "GoalCommand", [] as string[], {
    "condition": input["condition"],
    "continue": Option.getOrUndefined(input["continue"]),
    "session": Option.getOrUndefined(input["session"]),
    "model": Option.getOrUndefined(input["model"]),
    "agent": Option.getOrUndefined(input["agent"]),
    "variant": Option.getOrUndefined(input["variant"]),
    "token-budget": Option.getOrUndefined(input["token-budget"]),
    "format": input["format"],
  }),
)
