import { Option } from "effect"
import { Runtime } from "../../../framework/runtime"
import { passthrough } from "../../../framework/args"
import { Commands } from "../../../commands"

export default Runtime.handler(Commands.commands["debug"].commands["search"].commands["files"], async (input) => {
  const { FilesCommand } = await import("@/cli/cmd/debug/search")
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "query": Option.getOrUndefined(input["query"]),
    "glob": Option.getOrUndefined(input["glob"]),
    "limit": Option.getOrUndefined(input["limit"]),
  }
  await FilesCommand.handler(args)
})
