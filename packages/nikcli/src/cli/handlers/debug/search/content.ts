import { Option } from "effect"
import { Runtime } from "../../../framework/runtime"
import { passthrough } from "../../../framework/args"
import { Commands } from "../../../commands"
import { EOL } from "os"
import { FFF } from "@/file/fff"
import { bootstrap } from "@/cli/bootstrap"

export default Runtime.handler(Commands.commands["debug"].commands["search"].commands["content"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    pattern: input["pattern"],
    mode: input["mode"],
    limit: Option.getOrUndefined(input["limit"]),
  }
  await bootstrap(process.cwd(), async () => {
    const result = await FFF.grep(args.pattern, {
      // SAFETY: the builder declares `choices: ["plain", "regex", "fuzzy"] as const`
      // with a default, so yargs rejects any other value before the handler runs.
      mode: args.mode as "plain" | "regex" | "fuzzy",
      maxMatchesPerFile: args.limit ?? 200,
    })
    if (!result) {
      process.stdout.write("FFF not available" + EOL)
      return
    }
    process.stdout.write(JSON.stringify(result, null, 2) + EOL)
  })
})
