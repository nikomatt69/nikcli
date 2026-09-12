import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { delegate } from "../framework/yargs-bridge"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["attach"], (input) =>
  delegate(() => import("@/cli/cmd/tui/attach"), "AttachCommand", [] as string[], {
    "url": input["url"],
    "dir": Option.getOrUndefined(input["dir"]),
    "session": Option.getOrUndefined(input["session"]),
  }),
)
