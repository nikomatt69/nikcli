import { Runtime } from "../../framework/runtime"
import { Commands } from "../../commands"
import * as prompts from "@clack/prompts"
import { UI } from "@/cli/ui"
import { withInstanceAsync } from "@/effect"
import { loadAds, saveAds } from "./shared"
import type { AdsConfig } from "./shared"

export default Runtime.handler(Commands.commands["ads"].commands["enable"], async (_input) => {
  
  await withInstanceAsync({ directory: process.cwd() }, async () => {
    {
      UI.empty()
      prompts.intro("Enable ads")

      const ads = await loadAds()
      const next: AdsConfig = { ...ads, enabled: true }
      await saveAds(next)

      prompts.log.success("Ads enabled")
      prompts.outro("Done")
    }
  })
})
