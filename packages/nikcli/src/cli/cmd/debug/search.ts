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

const BenchmarkCommand = cmd({
  command: "benchmark <pattern>",
  describe: "benchmark fff vs ripgrep vs bun search backends",
  builder: (yargs) =>
    yargs
      .positional("pattern", {
        type: "string",
        demandOption: true,
        description: "Search pattern",
      })
      .option("rounds", {
        type: "number",
        default: 5,
        description: "Number of benchmark rounds",
      })
      .option("glob", {
        type: "string",
        description: "Glob filter",
      }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const result = await SearchBackend.benchmark({
        cwd: Instance.directory,
        pattern: args.pattern,
        glob: args.glob ? [args.glob] : undefined,
        rounds: args.rounds,
      })

      const fmt = (label: string, sample?: { available: boolean; averageMs: number; count: number }) => {
        if (!sample || !sample.available) return `  ${label.padEnd(12)} unavailable`
        return `  ${label.padEnd(12)} avg=${sample.averageMs.toFixed(1)}ms  count=${sample.count}`
      }

      process.stdout.write(
        [
          `Benchmark (${result.rounds} rounds)`,
          "",
          "Files:",
          fmt("fff", result.files.fff),
          fmt("rg", result.files.rg),
          fmt("bun", result.files.bun),
          "",
          "Grep:",
          fmt("fff", result.grep.fff),
          fmt("rg", result.grep.rg),
          fmt("bun", result.grep.bun),
          "",
        ].join(EOL),
      )
    })
  },
})
