import type { RouteModelInput } from "../route/client"
import { Provider } from "../provider"
import { ProviderID, type ModelID } from "../schema"
import * as AnthropicMessages from "../protocols/anthropic-messages"
import {
  withAnthropicOptions,
  type AnthropicProviderOptionsInput,
  type AnthropicVariant,
} from "./anthropic-options"

export type { AnthropicOptionsInput, AnthropicProviderOptionsInput, AnthropicVariant } from "./anthropic-options"

export const id = ProviderID.make("anthropic")

export type ModelOptions = Omit<RouteModelInput, "id" | "baseURL" | "providerOptions"> & {
  readonly baseURL?: string
  readonly providerOptions?: AnthropicProviderOptionsInput
  readonly variant?: AnthropicVariant
}

export const routes = [AnthropicMessages.route]

export const model = (modelID: string | ModelID, options: ModelOptions = {}) => {
  const { variant, ...rest } = options
  return AnthropicMessages.model(withAnthropicOptions(String(modelID), rest, { variant }))
}

export const provider = Provider.make({
  id,
  model,
})
