import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { passthrough } from "../framework/args"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["attach"], async (input) => {
  const { AttachCommand } = await import("@/cli/cmd/tui/attach")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "url": input["url"],
    "dir": Option.getOrUndefined(input["dir"]),
    "session": Option.getOrUndefined(input["session"]),
  }
  await AttachCommand.handler(args)
})
