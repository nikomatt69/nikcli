import { Runtime } from "../../framework/runtime"
import { Commands } from "../../commands"
import * as prompts from "@clack/prompts"
import { UI } from "@/cli/ui"
import { Locale } from "@nikcli-ai/util/locale"
import { withInstanceAsync } from "@/effect"
import { loadAds } from "./shared"

export default Runtime.handler(Commands.commands["ads"].commands["list"], async (_input) => {
  
  await withInstanceAsync({ directory: process.cwd() }, async () => {
    {
      UI.empty()
      prompts.intro("Ads")

      const ads = await loadAds()
      const items = ads.items ?? []
      if (items.length === 0) {
        prompts.log.warn("No ads configured")
        prompts.outro("Create ads with: nikcli ads create")
        return
      }

      const globalEnabled = ads.enabled !== false
      const globalLabel = globalEnabled ? "enabled" : "disabled"
      prompts.log.info(`Ads are ${globalLabel}`)
      if (ads.ratio !== undefined) {
        prompts.log.info(`Ads ratio: ${ads.ratio}`)
      }

      for (const item of items) {
        const itemEnabled = item.enabled !== false
        const icon = itemEnabled ? "+" : "-"
        const status = itemEnabled ? "enabled" : "disabled"
        prompts.log.info(`${icon} ${item.id} ${UI.Style.TEXT_DIM}${status}`)
        prompts.log.info(`    ${Locale.truncate(item.text, 96)}`)
        if (item.url) {
          prompts.log.info(`    ${UI.Style.TEXT_DIM}${item.url}`)
        }
      }

      prompts.outro(`${items.length} ad(s)`)
    }
  })
})
