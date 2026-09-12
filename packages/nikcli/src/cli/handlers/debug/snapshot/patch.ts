import { Runtime } from "../../../framework/runtime"
import { passthrough } from "../../../framework/args"
import { Commands } from "../../../commands"

export default Runtime.handler(Commands.commands["debug"].commands["snapshot"].commands["patch"], async (input) => {
  const { PatchCommand } = await import("@/cli/cmd/debug/snapshot")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "hash": input["hash"],
  }
  await PatchCommand.handler(args)
})
