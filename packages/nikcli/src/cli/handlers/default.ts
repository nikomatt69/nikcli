import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { delegate } from "../framework/yargs-bridge"
import { Commands } from "../commands"

/** The default command: `nikcli [project]` starts the TUI. */
export default Runtime.handler(Commands, (input) =>
  delegate(() => import("@/cli/cmd/tui/thread"), "TuiThreadCommand", [] as string[], {
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
  }),
)
