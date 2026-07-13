import * as SecureStore from "expo-secure-store"
import { modelKey } from "@/lib/model-catalog"

const VARIANTS_KEY = "nikcli_model_variants"

type VariantStore = Record<string, string | undefined>

async function readVariants(): Promise<VariantStore> {
  try {
    const raw = await SecureStore.getItemAsync(VARIANTS_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as VariantStore
  } catch {
    return {}
  }
}

async function writeVariants(store: VariantStore): Promise<void> {
  try {
    await SecureStore.setItemAsync(VARIANTS_KEY, JSON.stringify(store))
  } catch {
    // Ignore secure-store failures; in-memory session state still works.
  }
}

export async function getModelVariant(providerID: string, modelID: string): Promise<string | undefined> {
  const store = await readVariants()
  return store[modelKey(providerID, modelID)]
}

export async function setModelVariant(providerID: string, modelID: string, variant: string | undefined): Promise<void> {
  const store = await readVariants()
  const key = modelKey(providerID, modelID)
  if (variant) store[key] = variant
  else delete store[key]
  await writeVariants(store)
}
