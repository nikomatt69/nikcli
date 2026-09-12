import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["artifact"].commands["list"], async (input) => {
  const { ArtifactListCommand } = await import("@/cli/cmd/artifact")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "session-id": Option.getOrUndefined(input["session-id"]),
    "sessionId": Option.getOrUndefined(input["session-id"]),
  }
  await ArtifactListCommand.handler(args)
})
