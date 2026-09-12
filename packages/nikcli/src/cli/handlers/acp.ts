import { Runtime } from "../framework/runtime"
import { delegate } from "../framework/yargs-bridge"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["acp"], (input) =>
  delegate(() => import("@/cli/cmd/acp"), "AcpCommand", [] as string[], {
    "port": input["port"],
    "hostname": input["hostname"],
    "mdns": input["mdns"],
    "cors": input["cors"],
    "cwd": input["cwd"],
  }),
)
