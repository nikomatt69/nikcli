import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["artifact"].commands["login"], async (input) => {
  const { ArtifactLoginCommand } = await import("@/cli/cmd/artifact")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
  }
  await ArtifactLoginCommand.handler(args)
})
