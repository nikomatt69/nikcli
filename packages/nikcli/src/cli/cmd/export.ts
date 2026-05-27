import type { Argv } from "yargs"
import { Session } from "../../session"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { EOL } from "os"
import { Effect } from "effect"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"
import type { MessageV2 } from "@/session/message-v2"

function runSession<A, E>(effect: Effect.Effect<A, E, Session.Service>) {
  return runPromiseWithLayer(Session.defaultLayer, withCurrentInstance(effect))
}

export const ExportCommand = cmd({
  command: "export [sessionID]",
  describe: "export session data as JSON",
  builder: (yargs: Argv) => {
    return yargs.positional("sessionID", {
      describe: "session id to export",
      type: "string",
    })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      let sessionID = args.sessionID
      process.stderr.write(`Exporting session: ${sessionID ?? "latest"}`)

      if (!sessionID) {
        UI.empty()
        prompts.intro("Export session", {
          output: process.stderr,
        })

        const sessions = await runSession(
          Effect.gen(function* () {
            const session = yield* Session.Service
            const iterable = yield* session.list()
            return yield* Effect.promise(() => Array.fromAsync(iterable))
          }),
        )

        if (sessions.length === 0) {
          prompts.log.error("No sessions found", {
            output: process.stderr,
          })
          prompts.outro("Done", {
            output: process.stderr,
          })
          return
        }

        sessions.sort((a: Session.Info, b: Session.Info) => b.time.updated - a.time.updated)

        const selectedSession = await prompts.autocomplete({
          message: "Select session to export",
          maxItems: 10,
          options: sessions.map((session: Session.Info) => ({
            label: session.title,
            value: session.id,
            hint: `${new Date(session.time.updated).toLocaleString()} • ${session.id.slice(-8)}`,
          })),
          output: process.stderr,
        })

        if (prompts.isCancel(selectedSession)) {
          throw new UI.CancelledError()
        }

        sessionID = selectedSession as string

        prompts.outro("Exporting session...", {
          output: process.stderr,
        })
      }

      try {
        const { sessionInfo, messages } = await runSession(
          Effect.gen(function* () {
            const session = yield* Session.Service
            const sessionInfo = yield* session.get(sessionID!)
            const messages = yield* session.messages({ sessionID: sessionID! })
            return { sessionInfo, messages }
          }),
        )

        const exportData = {
          info: sessionInfo,
          messages: messages.map((msg: MessageV2.WithParts) => ({
            info: msg.info,
            parts: msg.parts,
          })),
        }

        process.stdout.write(JSON.stringify(exportData, null, 2))
        process.stdout.write(EOL)
      } catch  {
        UI.error(`Session not found: ${sessionID!}`)
        process.exit(1)
      }
    })
  },
})
