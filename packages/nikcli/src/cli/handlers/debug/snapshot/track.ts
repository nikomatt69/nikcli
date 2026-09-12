import { Runtime } from "../../../framework/runtime"
import { passthrough } from "../../../framework/args"
import { Commands } from "../../../commands"

export default Runtime.handler(Commands.commands["debug"].commands["snapshot"].commands["track"], async (input) => {
  const { TrackCommand } = await import("@/cli/cmd/debug/snapshot")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
  }
  await TrackCommand.handler(args)
})
