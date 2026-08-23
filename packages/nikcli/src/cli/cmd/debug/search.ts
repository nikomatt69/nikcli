import { EOL } from "os"
import { FFF } from "../../../file/fff"
import { SearchBackend } from "../../../file/searchBackend"
import { Instance } from "../../../project/instance"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"

export const SearchCommand = cmd({
  command: "search",
  describe: "fff search debugging utilities",
  builder: (yargs) => yargs.command(TreeCommand).command(FilesCommand).command(ContentCommand).demandCommand(),
  async handler() {},
})

const TreeCommand = cmd({
  command: "tree",
  describe: "show file tree using fff",
  builder: (yargs) =>
    yargs.option("limit", {
      type: "number",
      description: "Max nodes to render",
    }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const output = await SearchBackend.tree({ cwd: Instance.directory, limit: args.limit })
      process.stdout.write(output + EOL)
    })
  },
})

const FilesCommand = cmd({
  command: "files",
  describe: "list files using fff",
  builder: (yargs) =>
    yargs
      .option("query", {
        type: "string",
        description: "Filter files by query",
      })
      .option("glob", {
        type: "string",
        description: "Glob pattern to match files",
      })
      .option("limit", {
        type: "number",
        description: "Limit number of results",
      }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const limit = args.limit ?? 100
      const files = await FFF.files({
        cwd: Instance.directory,
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
  },
})

const ContentCommand = cmd({
  command: "content <pattern>",
  describe: "search file contents using fff",
  builder: (yargs) =>
    yargs
      .positional("pattern", {
        type: "string",
        demandOption: true,
        description: "Search pattern",
      })
      .option("mode", {
        type: "string",
        choices: ["plain", "regex", "fuzzy"] as const,
        default: "plain",
        description: "Grep mode",
      })
      .option("limit", {
        type: "number",
        description: "Limit number of results",
      }),
  async handler(args) {
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
  },
})
