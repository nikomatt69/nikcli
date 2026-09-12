import { Runtime } from "../../../framework/runtime"
import { passthrough } from "../../../framework/args"
import { Commands } from "../../../commands"

export default Runtime.handler(Commands.commands["debug"].commands["snapshot"].commands["diff"], async (input) => {
  const { DiffCommand } = await import("@/cli/cmd/debug/snapshot")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "hash": input["hash"],
  }
  await DiffCommand.handler(args)
})
