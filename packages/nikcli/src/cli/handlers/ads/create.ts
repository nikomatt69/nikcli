import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["ads"].commands["create"], async (input) => {
  const { AdsCreateCommand } = await import("@/cli/cmd/ads")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "id": Option.getOrUndefined(input["id"]),
    "text": Option.getOrUndefined(input["text"]),
    "url": Option.getOrUndefined(input["url"]),
    "disabled": Option.getOrUndefined(input["disabled"]),
  }
  await AdsCreateCommand.handler(args)
})
