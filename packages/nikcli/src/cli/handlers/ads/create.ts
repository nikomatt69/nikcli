import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"
import * as prompts from "@clack/prompts"
import { UI } from "@/cli/ui"
import { withInstanceAsync } from "@/effect"
import { slug, suggestId, validateUrl, normalizeUrl, loadAds, saveAds } from "./shared"
import type { AdsConfig, AdsItem } from "./shared"

export default Runtime.handler(Commands.commands["ads"].commands["create"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "id": Option.getOrUndefined(input["id"]),
    "text": Option.getOrUndefined(input["text"]),
    "url": Option.getOrUndefined(input["url"]),
    "disabled": Option.getOrUndefined(input["disabled"]),
  }
  await withInstanceAsync({ directory: process.cwd() }, async () => {
    {
      UI.empty()
      prompts.intro("Create ad")

      const ads = await loadAds()
      const items = ads.items ?? []

      const textInput = await (async () => {
        if (typeof args.text === "string") return args.text
        const value = await prompts.text({
          message: "Ad text",
          validate: (input) => (input && input.trim().length > 0 ? undefined : "Required"),
        })
        if (prompts.isCancel(value)) throw new UI.CancelledError()
        return value
      })()

      const text = textInput.trim()
      if (!text) {
        prompts.log.error("Ad text is required")
        prompts.outro("Done")
        return
      }

      const suggestion = suggestId(text, items)
      const idInput = await (async () => {
        if (typeof args.id === "string") return args.id
        const value = await prompts.text({
          message: `Identifier (optional, default: ${suggestion})`,
        })
        if (prompts.isCancel(value)) throw new UI.CancelledError()
        return value
      })()

      const id = slug(idInput || "") || suggestion
      const exists = items.some((item) => item.id === id)
      if (exists) {
        prompts.log.error(`Ad identifier already exists: ${id}`)
        prompts.outro("Done")
        return
      }

      const urlInput = await (async () => {
        if (typeof args.url === "string") return args.url
        const value = await prompts.text({
          message: "URL (optional)",
          validate: validateUrl,
        })
        if (prompts.isCancel(value)) throw new UI.CancelledError()
        return value
      })()

      const urlError = validateUrl(urlInput)
      if (urlError) {
        prompts.log.error(urlError)
        prompts.outro("Done")
        return
      }

      const enabled = await (async () => {
        if (args.disabled) return false
        const value = await prompts.confirm({
          message: "Enable this ad now?",
          initialValue: true,
        })
        if (prompts.isCancel(value)) throw new UI.CancelledError()
        return value
      })()

      const entry: AdsItem = {
        id,
        text,
        url: normalizeUrl(urlInput) ?? undefined,
        enabled,
      }

      const next: AdsConfig = {
        ...ads,
        enabled: ads.enabled ?? true,
        items: items.concat(entry),
      }

      await saveAds(next)
      prompts.log.success(`Ad created: ${id}`)
      prompts.outro("Done")
    }
  })
})
