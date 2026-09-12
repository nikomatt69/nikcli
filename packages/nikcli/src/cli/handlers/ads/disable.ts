import { Runtime } from "../../framework/runtime"
import { Commands } from "../../commands"
import * as prompts from "@clack/prompts"
import { UI } from "@/cli/ui"
import { withInstanceAsync } from "@/effect"
import { loadAds, saveAds } from "./shared"
import type { AdsConfig } from "./shared"

export default Runtime.handler(Commands.commands["ads"].commands["disable"], async (_input) => {
  await withInstanceAsync({ directory: process.cwd() }, async () => {
    {
      UI.empty()
      prompts.intro("Disable ads")

      const ads = await loadAds()
      const next: AdsConfig = { ...ads, enabled: false }
      await saveAds(next)

      prompts.log.success("Ads disabled")
      prompts.outro("Done")
    }
  })
})
