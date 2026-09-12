import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"
import { UI } from "@/cli/ui"
import { config } from "./shared"

export default Runtime.handler(Commands.commands["service"].commands["set"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "key": input["key"],
    "value": input["value"],
    "nested": Option.getOrUndefined(input["nested"]),
  }
  const ServiceConfig = await config()
  await ServiceConfig.set(args.key as string, args.value as string, args.nested as string | undefined)
  UI.println(`set ${args.key}; the service will pick it up on its next start`)
})
