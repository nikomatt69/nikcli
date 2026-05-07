import { EOL } from "os"
import { File } from "../../../file"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"
import { SearchBackend } from "@/file/searchBackend"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"
import { Effect } from "effect"

function runFile<A, E>(effect: Effect.Effect<A, E, File.Service>) {
  return runPromiseWithLayer(File.defaultLayer, withCurrentInstance(effect))
}

const FileSearchCommand = cmd({
  command: "search <query>",
  describe: "search files by query",
  builder: (yargs) =>
    yargs.positional("query", {
      type: "string",
      demandOption: true,
      description: "Search query",
    }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const results = await runFile(
        Effect.gen(function* () {
          const file = yield* File.Service
          return yield* file.search({ query: args.query })
        }),
      )
      process.stdout.write(results.join(EOL) + EOL)
    })
  },
})

const FileReadCommand = cmd({
  command: "read <path>",
  describe: "read file contents as JSON",
  builder: (yargs) =>
    yargs.positional("path", {
      type: "string",
      demandOption: true,
      description: "File path to read",
    }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const content = await runFile(
        Effect.gen(function* () {
          const file = yield* File.Service
          return yield* file.read(args.path)
        }),
      )
      process.stdout.write(JSON.stringify(content, null, 2) + EOL)
    })
  },
})

const FileStatusCommand = cmd({
  command: "status",
  describe: "show file status information",
  builder: (yargs) => yargs,
  async handler() {
    await bootstrap(process.cwd(), async () => {
      const status = await runFile(
        Effect.gen(function* () {
          const file = yield* File.Service
          return yield* file.status()
        }),
      )
      process.stdout.write(JSON.stringify(status, null, 2) + EOL)
    })
  },
})

const FileListCommand = cmd({
  command: "list <path>",
  describe: "list files in a directory",
  builder: (yargs) =>
    yargs.positional("path", {
      type: "string",
      demandOption: true,
      description: "File path to list",
    }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const files = await runFile(
        Effect.gen(function* () {
          const file = yield* File.Service
          return yield* file.list(args.path)
        }),
      )
      process.stdout.write(JSON.stringify(files, null, 2) + EOL)
    })
  },
})

const FileTreeCommand = cmd({
  command: "tree [dir]",
  describe: "show directory tree",
  builder: (yargs) =>
    yargs.positional("dir", {
      type: "string",
      description: "Directory to tree",
      default: process.cwd(),
    }),
  async handler(args) {
    const files = await SearchBackend.tree({ cwd: args.dir, limit: 200 })
    console.log(JSON.stringify(files, null, 2))
  },
})

export const FileCommand = cmd({
  command: "file",
  describe: "file system debugging utilities",
  builder: (yargs) =>
    yargs
      .command(FileReadCommand)
      .command(FileStatusCommand)
      .command(FileListCommand)
      .command(FileSearchCommand)
      .command(FileTreeCommand)
      .demandCommand(),
  async handler() {},
})
