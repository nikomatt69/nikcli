import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["github"].commands["install"], async (input) => {
  const { GithubInstallCommand } = await import("@/cli/cmd/github")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
  }
  await GithubInstallCommand.handler(args)
})
