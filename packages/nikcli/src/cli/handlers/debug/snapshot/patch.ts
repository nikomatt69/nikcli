import { Runtime } from "../../../framework/runtime"
import { passthrough } from "../../../framework/args"
import { Commands } from "../../../commands"
import { Snapshot } from "@/snapshot"
import { bootstrap } from "@/cli/bootstrap"
import { Effect } from "effect"
import { runSnapshot } from "./shared"

export default Runtime.handler(Commands.commands["debug"].commands["snapshot"].commands["patch"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "hash": input["hash"],
  }
  await bootstrap(process.cwd(), async () => {
    console.log(
      await runSnapshot(
        Effect.gen(function* () {
          const snapshot = yield* Snapshot.Service
          return yield* snapshot.patch(args.hash)
        }),
      ),
    )
  })
})
