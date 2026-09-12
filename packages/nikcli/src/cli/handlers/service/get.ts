import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"
import { UI } from "@/cli/ui"
import { config } from "./shared"

export default Runtime.handler(Commands.commands["service"].commands["get"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    key: Option.getOrUndefined(input["key"]),
  }
  const ServiceConfig = await config()
  const value = await ServiceConfig.get(args.key)
  UI.println(value === undefined ? "" : JSON.stringify(value, null, 2))
})
