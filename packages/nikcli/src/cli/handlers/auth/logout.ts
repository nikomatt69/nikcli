import { Runtime } from "../../framework/runtime"
import { Commands } from "../../commands"
import { Auth } from "@/auth"
import * as prompts from "@clack/prompts"
import { UI } from "@/cli/ui"
import { ModelsDev } from "@/provider/models"
import { Effect } from "effect"
import { log, runAuth, authAll } from "./shared"

export default Runtime.handler(Commands.commands["auth"].commands["logout"], async (_input) => {
  
  UI.empty()
  try {
    const credentials = await authAll().then((x) => Object.entries(x))
    prompts.intro("Remove credential")

    if (credentials.length === 0) {
      prompts.log.error("No credentials found")
      return
    }

    const database = await ModelsDev.get()
    const providerID = await prompts.select({
      message: "Select provider",
      options: credentials.map(([key, value]) => ({
        label: (database[key]?.name || key) + UI.Style.TEXT_DIM + " (" + value.type + ")",
        value: key,
      })),
    })

    if (prompts.isCancel(providerID)) {
      prompts.outro("Done")
      return
    }

    log.info("Logging out provider", { provider: providerID })
    await runAuth(
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.remove(providerID)
      }),
    )
    prompts.outro("Logout successful")
  } catch (error) {
    log.error("Logout failed", { error })
    prompts.outro("Done")
  }
})
