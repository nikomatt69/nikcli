import { Runtime } from "../framework/runtime"
import { passthrough } from "../framework/args"
import { Commands } from "../commands"

export default Runtime.handler(Commands.commands["acp"], async (input) => {
  const { AcpCommand } = await import("@/cli/cmd/acp")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "port": input["port"],
    "hostname": input["hostname"],
    "mdns": input["mdns"],
    "cors": input["cors"],
    "cwd": input["cwd"],
  }
  await AcpCommand.handler(args)
})
