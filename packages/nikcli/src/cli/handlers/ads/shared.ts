import * as prompts from "@clack/prompts"
import { UI } from "@/cli/ui"
import { Config } from "@/config/config"
import { Locale } from "@nikcli-ai/util/locale"
import { runPromiseWithLayer } from "@/effect"
import { Effect } from "effect"

/** Helpers shared by the `ads` commands. */

export type AdsConfig = Config.Ads
export type AdsItem = Config.AdsItem

export function runConfig<A, E>(effect: Effect.Effect<A, E, Config.Service>) {
  return runPromiseWithLayer(Config.defaultLayer, effect)
}

export function slug(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
}

export function suggestId(text: string, items: AdsItem[]) {
  const base = slug(text) || "ad"
  const matches = items.filter((item) => item.id === base || item.id.startsWith(base + "-")).length
  return matches === 0 ? base : `${base}-${matches + 1}`
}

export function validateUrl(value: string | undefined) {
  if (!value) return undefined
  try {
    new URL(value)
    return undefined
  } catch {
    return "Enter a valid URL (https://...)"
  }
}

export function normalizeUrl(value: string) {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export async function loadAds(): Promise<AdsConfig> {
  const config = await runConfig(
    Effect.gen(function* () {
      const service = yield* Config.Service
      return yield* service.getGlobal()
    }),
  )
  return config.ads ?? {}
}

export async function saveAds(next: AdsConfig): Promise<void> {
  await runConfig(
    Effect.gen(function* () {
      const service = yield* Config.Service
      yield* service.updateGlobal({ ads: next })
    }),
  )
}

export async function selectId(items: AdsItem[], value: string | undefined, message: string) {
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
