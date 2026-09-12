import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"
import { loginAccount } from "./shared"

export default Runtime.handler(Commands.commands["account"].commands["login"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    server: Option.getOrUndefined(input["server"]),
  }
  await loginAccount(args.server)
})
