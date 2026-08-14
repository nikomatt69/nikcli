import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Config } from "../../config/config"
import { Locale } from "@nikcli-ai/util/locale"
import { runPromiseWithLayer, withInstanceAsync } from "@/effect"
import { Effect } from "effect"
import type { Argv } from "yargs"

type AdsConfig = Config.Ads
type AdsItem = Config.AdsItem

function runConfig<A, E>(effect: Effect.Effect<A, E, Config.Service>) {
  return runPromiseWithLayer(Config.defaultLayer, effect)
}

function slug(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
}

function suggestId(text: string, items: AdsItem[]) {
  const base = slug(text) || "ad"
  const matches = items.filter((item) => item.id === base || item.id.startsWith(base + "-")).length
  return matches === 0 ? base : `${base}-${matches + 1}`
}

function validateUrl(value: string | undefined) {
  if (!value) return undefined
  try {
    new URL(value)
    return undefined
  } catch {
    return "Enter a valid URL (https://...)"
  }
}

function normalizeUrl(value: string) {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

async function loadAds(): Promise<AdsConfig> {
  const config = await runConfig(
    Effect.gen(function* () {
      const service = yield* Config.Service
      return yield* service.getGlobal()
    }),
  )
  return config.ads ?? {}
}

async function saveAds(next: AdsConfig): Promise<void> {
  await runConfig(
    Effect.gen(function* () {
      const service = yield* Config.Service
      yield* service.updateGlobal({ ads: next })
    }),
  )
}

async function selectId(items: AdsItem[], value: string | undefined, message: string) {
  const provided = value?.trim()
  if (provided) return provided

  const options = items.map((item) => ({
    label: item.id,
    value: item.id,
    hint: Locale.truncate(item.text, 60),
  }))

  const selected = await prompts.select({
    message,
    options,
  })
  if (prompts.isCancel(selected)) throw new UI.CancelledError()
  return selected
}

export const AdsCommand = cmd({
  command: "ads",
  describe: "manage ads",
  builder: (yargs) =>
    yargs
      .command(AdsCreateCommand)
      .command(AdsListCommand)
      .command(AdsRemoveCommand)
      .command(AdsToggleCommand)
      .command(AdsEnableCommand)
      .command(AdsDisableCommand)
      .demandCommand(),
  async handler() {},
})

export const AdsCreateCommand = cmd({
  command: "create",
  describe: "create a new ad",
  builder: (yargs: Argv) =>
    yargs
      .option("id", {
        type: "string",
        describe: "ad identifier",
      })
      .option("text", {
        type: "string",
        describe: "ad text",
      })
      .option("url", {
        type: "string",
        describe: "optional URL",
      })
      .option("disabled", {
        type: "boolean",
        describe: "create the ad as disabled",
      }),
  async handler(args) {
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
  },
})

export const AdsListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list ads",
  async handler() {
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
  },
})

export const AdsRemoveCommand = cmd({
  command: "remove [id]",
  aliases: ["rm"],
  describe: "remove an ad",
  builder: (yargs: Argv) =>
    yargs.positional("id", {
      describe: "ad identifier",
      type: "string",
    }),
  async handler(args) {
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
  },
})

export const AdsToggleCommand = cmd({
  command: "toggle [id]",
  describe: "toggle an ad on or off",
  builder: (yargs: Argv) =>
    yargs.positional("id", {
      describe: "ad identifier",
      type: "string",
    }),
  async handler(args) {
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
  },
})

export const AdsEnableCommand = cmd({
  command: "enable",
  describe: "enable ads globally",
  async handler() {
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
  },
})

export const AdsDisableCommand = cmd({
  command: "disable",
  describe: "disable ads globally",
  async handler() {
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
  },
})
