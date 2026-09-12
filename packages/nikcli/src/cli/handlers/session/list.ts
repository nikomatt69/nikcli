import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"
import { Session } from "@/session"
import { bootstrap } from "@/cli/bootstrap"
import { Effect } from "effect"
import { runSession, pagerCmd, formatSessionTable, formatSessionJSON } from "./shared"

export default Runtime.handler(Commands.commands["session"].commands["list"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "max-count": Option.getOrUndefined(input["max-count"]),
    "maxCount": Option.getOrUndefined(input["max-count"]),
    "format": input["format"],
  }
  await bootstrap(process.cwd(), async () => {
    const sessions = await runSession(
      Effect.gen(function* () {
        const session = yield* Session.Service
        const iterable = yield* session.list()
        const all = yield* Effect.promise(() => Array.fromAsync(iterable))
        return all.filter((item) => !item.parentID)
      }),
    )

    sessions.sort((a: Session.Info, b: Session.Info) => b.time.updated - a.time.updated)

    const limitedSessions = args.maxCount ? sessions.slice(0, args.maxCount) : sessions

    if (limitedSessions.length === 0) {
      return
    }

    let output: string
    if (args.format === "json") {
      output = formatSessionJSON(limitedSessions)
    } else {
      output = formatSessionTable(limitedSessions)
    }

    const shouldPaginate = process.stdout.isTTY && !args.maxCount && args.format === "table"

    if (shouldPaginate) {
      const proc = Bun.spawn({
        windowsHide: true,
        cmd: pagerCmd(),
        stdin: "pipe",
        stdout: "inherit",
        stderr: "inherit",
      })

      proc.stdin.write(output)
      proc.stdin.end()
      await proc.exited
    } else {
      console.log(output)
    }
  })
})
