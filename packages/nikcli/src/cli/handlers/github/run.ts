import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["github"].commands["run"], async (input) => {
  const { GithubRunCommand } = await import("@/cli/cmd/github")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "event": Option.getOrUndefined(input["event"]),
    "token": Option.getOrUndefined(input["token"]),
  }
  await GithubRunCommand.handler(args)
})
