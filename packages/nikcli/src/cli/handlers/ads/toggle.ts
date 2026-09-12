import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"
import * as prompts from "@clack/prompts"
import { UI } from "@/cli/ui"
import { withInstanceAsync } from "@/effect"
import { loadAds, saveAds, selectId } from "./shared"
import type { AdsConfig } from "./shared"

export default Runtime.handler(Commands.commands["ads"].commands["toggle"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    id: Option.getOrUndefined(input["id"]),
  }
  await withInstanceAsync({ directory: process.cwd() }, async () => {
    {
      UI.empty()
      prompts.intro("Toggle ad")

      const ads = await loadAds()
      const items = ads.items ?? []
      if (items.length === 0) {
        prompts.log.warn("No ads configured")
        prompts.outro("Done")
        return
      }

      const id = await selectId(items, args.id, "Select ad to toggle")
      const found = items.some((item) => item.id === id)
      if (!found) {
        prompts.log.error(`Ad not found: ${id}`)
        prompts.outro("Done")
        return
      }
      const nextItems = items.map((item) => {
        if (item.id !== id) return item
        const enabled = item.enabled === false
        return { ...item, enabled }
      })

      const next: AdsConfig = {
        ...ads,
        items: nextItems,
      }

      await saveAds(next)
      const nextItem = nextItems.find((item) => item.id === id)
      const status = nextItem?.enabled === false ? "disabled" : "enabled"
      prompts.log.success(`Ad ${id} is now ${status}`)
      prompts.outro("Done")
    }
  })
})
