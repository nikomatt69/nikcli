import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { delegate } from "../framework/yargs-bridge"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["run"], (input) =>
  delegate(() => import("@/cli/cmd/run"), "RunCommand", [] as string[], {
    "message": input["message"],
    "command": Option.getOrUndefined(input["command"]),
    "continue": Option.getOrUndefined(input["continue"]),
    "session": Option.getOrUndefined(input["session"]),
    "share": Option.getOrUndefined(input["share"]),
    "model": Option.getOrUndefined(input["model"]),
    "agent": Option.getOrUndefined(input["agent"]),
    "format": input["format"],
    "file": input["file"],
    "title": Option.getOrUndefined(input["title"]),
    "attach": Option.getOrUndefined(input["attach"]),
    "port": Option.getOrUndefined(input["port"]),
    "variant": Option.getOrUndefined(input["variant"]),
  }),
)
