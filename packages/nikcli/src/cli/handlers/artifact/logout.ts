import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["artifact"].commands["logout"], async (input) => {
  const { ArtifactLogoutCommand } = await import("@/cli/cmd/artifact")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
  }
  await ArtifactLogoutCommand.handler(args)
})
