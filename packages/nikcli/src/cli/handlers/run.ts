import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { passthrough } from "../framework/args"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["run"], async (input) => {
  const { RunCommand } = await import("@/cli/cmd/run")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
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
  }
  await RunCommand.handler(args)
})
