import { Runtime } from "../framework/runtime"
import { delegate } from "../framework/yargs-bridge"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["serve"], (input) =>
  delegate(() => import("@/cli/cmd/serve"), "ServeCommand", [] as string[], {
    "port": input["port"],
    "hostname": input["hostname"],
    "mdns": input["mdns"],
    "cors": input["cors"],
    "stdio": input["stdio"],
    "service": input["service"],
  }),
)
