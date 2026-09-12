import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { passthrough } from "../framework/args"
import { Commands } from "../commands"

/** The default command: `nikcli [project]` starts the TUI. */
export default Runtime.handler(Commands, async (input) => {
  const { TuiThreadCommand } = await import("@/cli/cmd/tui/thread")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "port": input["port"],
    "hostname": input["hostname"],
    "mdns": input["mdns"],
    "cors": input["cors"],
    "project": Option.getOrUndefined(input["project"]),
    "standalone": input["standalone"],
    "model": Option.getOrUndefined(input["model"]),
    "continue": Option.getOrUndefined(input["continue"]),
    "session": Option.getOrUndefined(input["session"]),
    "prompt": Option.getOrUndefined(input["prompt"]),
    "agent": Option.getOrUndefined(input["agent"]),
  }
  await TuiThreadCommand.handler(args)
})
