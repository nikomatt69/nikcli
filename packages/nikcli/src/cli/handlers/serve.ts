import { Runtime } from "../framework/runtime"
import { passthrough } from "../framework/args"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["serve"], async (input) => {
  const { ServeCommand } = await import("@/cli/cmd/serve")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "port": input["port"],
    "hostname": input["hostname"],
    "mdns": input["mdns"],
    "cors": input["cors"],
    "stdio": input["stdio"],
    "service": input["service"],
  }
  await ServeCommand.handler(args)
})
