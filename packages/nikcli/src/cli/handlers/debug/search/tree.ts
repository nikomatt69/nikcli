import { Option } from "effect"
import { Runtime } from "../../../framework/runtime"
import { passthrough } from "../../../framework/args"
import { Commands } from "../../../commands"
import { EOL } from "os"
import { SearchBackend } from "@/file/searchBackend"
import { bootstrap } from "@/cli/bootstrap"

export default Runtime.handler(Commands.commands["debug"].commands["search"].commands["tree"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    limit: Option.getOrUndefined(input["limit"]),
  }
  await bootstrap(process.cwd(), async (instance) => {
    const output = await SearchBackend.tree({ cwd: instance.directory, limit: args.limit })
    process.stdout.write(output + EOL)
  })
})
