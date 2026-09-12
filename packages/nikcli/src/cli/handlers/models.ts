import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { passthrough } from "../framework/args"
import { Commands } from "../commands"
import { Provider } from "@/provider/provider"
import { ModelsDev } from "@/provider/models"
import { UI } from "@/cli/ui"
import { EOL } from "os"
import { Effect } from "effect"
import { runPromiseWithLayer, withCurrentInstance, withInstanceAsync } from "@/effect"

export function runProvider<A, E>(effect: Effect.Effect<A, E, Provider.Service>) {
  return runPromiseWithLayer(Provider.defaultLayer, withCurrentInstance(effect))
}

export default Runtime.handler(Commands.commands["models"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "provider": Option.getOrUndefined(input["provider"]),
    "verbose": Option.getOrUndefined(input["verbose"]),
    "refresh": Option.getOrUndefined(input["refresh"]),
  }
  if (args.refresh) {
    await ModelsDev.refresh()
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Models cache refreshed" + UI.Style.TEXT_NORMAL)
  }

  await withInstanceAsync({ directory: process.cwd() }, async () => {
    {
      const providers = await runProvider(
        Effect.gen(function* () {
          const provider = yield* Provider.Service
          return yield* provider.list()
        }),
      )

      function printModels(providerID: string, verbose?: boolean) {
        const provider = providers[providerID]
        const sortedModels = Object.entries(provider.models).sort(([a], [b]) => a.localeCompare(b))
        for (const [modelID, model] of sortedModels) {
          process.stdout.write(`${providerID}/${modelID}`)
          process.stdout.write(EOL)
          if (verbose) {
            process.stdout.write(JSON.stringify(model, null, 2))
            process.stdout.write(EOL)
          }
        }
      }

      if (args.provider) {
        const provider = providers[args.provider]
        if (!provider) {
          UI.error(`Provider not found: ${args.provider}`)
          return
        }

        printModels(args.provider, args.verbose)
        return
      }

      const providerIDs = Object.keys(providers).sort((a, b) => {
        const aIsNikcli = a.startsWith("nikcli")
        const bIsNikcli = b.startsWith("nikcli")
        if (aIsNikcli && !bIsNikcli) return -1
        if (!aIsNikcli && bIsNikcli) return 1
        return a.localeCompare(b)
      })

      for (const providerID of providerIDs) {
        printModels(providerID, args.verbose)
      }
    }
  })
})
