import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"
import * as prompts from "@clack/prompts"
import { UI } from "@/cli/ui"
import { withInstanceAsync } from "@/effect"
import { loadAds, saveAds, selectId } from "./shared"
import type { AdsConfig } from "./shared"

export default Runtime.handler(Commands.commands["ads"].commands["remove"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "id": Option.getOrUndefined(input["id"]),
  }
  await withInstanceAsync({ directory: process.cwd() }, async () => {
    {
      UI.empty()
      prompts.intro("Remove ad")

      const ads = await loadAds()
      const items = ads.items ?? []
      if (items.length === 0) {
        prompts.log.warn("No ads configured")
        prompts.outro("Done")
        return
      }

      const id = await selectId(items, args.id, "Select ad to remove")
      const nextItems = items.filter((item) => item.id !== id)
      if (nextItems.length === items.length) {
        prompts.log.error(`Ad not found: ${id}`)
        prompts.outro("Done")
        return
      }

      const next: AdsConfig = {
        ...ads,
        items: nextItems,
      }

      await saveAds(next)
      prompts.log.success(`Ad removed: ${id}`)
      prompts.outro("Done")
    }
  })
})
