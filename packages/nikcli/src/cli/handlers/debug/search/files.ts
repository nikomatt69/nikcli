import { Option } from "effect"
import { Runtime } from "../../../framework/runtime"
import { passthrough } from "../../../framework/args"
import { Commands } from "../../../commands"
import { EOL } from "os"
import { FFF } from "@/file/fff"
import { bootstrap } from "@/cli/bootstrap"

export default Runtime.handler(Commands.commands["debug"].commands["search"].commands["files"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    query: Option.getOrUndefined(input["query"]),
    glob: Option.getOrUndefined(input["glob"]),
    limit: Option.getOrUndefined(input["limit"]),
  }
  await bootstrap(process.cwd(), async (instance) => {
    const limit = args.limit ?? 100
    const files = await FFF.files({
      cwd: instance.directory,
      glob: args.glob ? [args.glob] : undefined,
      hidden: true,
      limit,
    })
    if (!files) {
      process.stdout.write("FFF not available" + EOL)
      return
    }
    const filtered = args.query ? files.filter((f) => f.includes(args.query!)) : files
    process.stdout.write(filtered.join(EOL) + EOL)
  })
})
