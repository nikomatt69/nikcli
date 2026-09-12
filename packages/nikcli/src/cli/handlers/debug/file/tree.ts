import { Runtime } from "../../../framework/runtime"
import { passthrough } from "../../../framework/args"
import { Commands } from "../../../commands"
import { SearchBackend } from "@/file/searchBackend"

export default Runtime.handler(Commands.commands["debug"].commands["file"].commands["tree"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    dir: input["dir"],
  }
  const files = await SearchBackend.tree({ cwd: args.dir, limit: 200 })
  console.log(JSON.stringify(files, null, 2))
})
