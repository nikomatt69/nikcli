import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"

export default Runtime.handler(Commands.commands["debug"].commands["skill"], async (input) => {
  const { SkillCommand } = await import("@/cli/cmd/debug/skill")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
  }
  await SkillCommand.handler(args)
})
