import { Runtime } from "../../../framework/runtime"
import { Commands } from "../../../commands"
import { Snapshot } from "@/snapshot"
import { bootstrap } from "@/cli/bootstrap"
import { Effect } from "effect"
import { runSnapshot } from "./shared"

export default Runtime.handler(Commands.commands["debug"].commands["snapshot"].commands["track"], async (_input) => {
  
  await bootstrap(process.cwd(), async () => {
    console.log(
      await runSnapshot(
        Effect.gen(function* () {
          const snapshot = yield* Snapshot.Service
          return yield* snapshot.track()
        }),
      ),
    )
  })
})
