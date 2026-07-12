import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native"
import { Stack, useFocusEffect } from "expo-router"
import { ActionButton } from "@/components/ui/ActionButton"
import { ErrorBanner } from "@/components/ui/ErrorBanner"
import { InfoChip } from "@/components/ui/InfoChip"
import { SurfaceCard } from "@/components/ui/SurfaceCard"
import { TextField } from "@/components/ui/TextField"
import { useServer } from "@/lib/server-context"
import { formatVariantLabel, listEnabledVariants } from "@/lib/model-catalog"
import { getModelVariant, setModelVariant } from "@/lib/model-preferences"
import { MOBILE_DEFAULT_MODEL_ID, MOBILE_DEFAULT_PROVIDER_ID, type ProviderCatalog } from "@/lib/types"

function optionChipClass(active: boolean) {
  return active ? "border-accent/30 bg-accent/12" : "border-border bg-background/70"
}

function optionChipTextClass(active: boolean) {
  return active ? "text-accent-light" : "text-ink"
}

function providerFallback(catalog: ProviderCatalog | null) {
  if (!catalog?.all.length) return MOBILE_DEFAULT_PROVIDER_ID
  if (catalog.all.some((provider) => provider.id === MOBILE_DEFAULT_PROVIDER_ID)) return MOBILE_DEFAULT_PROVIDER_ID
  return [...catalog.all].sort((left, right) => left.name.localeCompare(right.name)).at(0)?.id
}

function modelFallback(catalog: ProviderCatalog | null, providerID: string) {
  const provider = catalog?.all.find((item) => item.id === providerID)
  if (!provider) return providerID === MOBILE_DEFAULT_PROVIDER_ID ? MOBILE_DEFAULT_MODEL_ID : undefined
  if (provider.models[MOBILE_DEFAULT_MODEL_ID] && providerID === MOBILE_DEFAULT_PROVIDER_ID)
    return MOBILE_DEFAULT_MODEL_ID
  if (catalog?.default[providerID] && provider.models[catalog.default[providerID]]) return catalog.default[providerID]
  return Object.values(provider.models)
    .sort((left, right) => left.name.localeCompare(right.name))
    .at(0)?.id
}

export default function ProvidersSettingsScreen() {
  const { client, config, save } = useServer()
  const [providerCatalog, setProviderCatalog] = useState<ProviderCatalog | null>(null)
  const [providerSearch, setProviderSearch] = useState("")
  const [modelSearch, setModelSearch] = useState("")
  const [selectedProviderID, setSelectedProviderID] = useState(config?.modelProviderID ?? MOBILE_DEFAULT_PROVIDER_ID)
  const [selectedModelID, setSelectedModelID] = useState(config?.modelID ?? MOBILE_DEFAULT_MODEL_ID)
  const [selectedVariant, setSelectedVariant] = useState<string | undefined>()
  const selectedProviderIDRef = useRef(selectedProviderID)
  const selectedModelIDRef = useRef(selectedModelID)
  selectedProviderIDRef.current = selectedProviderID
  selectedModelIDRef.current = selectedModelID
  const [providerKey, setProviderKey] = useState("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [defaultsSaving, setDefaultsSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!client) {
      setProviderCatalog(null)
      return
    }

    try {
      setLoading(true)
      const catalog = await client.listProviders()
      setProviderCatalog(catalog)

      const nextProvider = (() => {
        if (config?.modelProviderID && catalog.all.some((item) => item.id === config.modelProviderID))
          return config.modelProviderID
        if (catalog.all.some((item) => item.id === selectedProviderIDRef.current)) return selectedProviderIDRef.current
        return providerFallback(catalog)
      })()

      if (nextProvider) {
        setSelectedProviderID(nextProvider)
        const nextModel = (() => {
          const provider = catalog.all.find((item) => item.id === nextProvider)
          if (!provider) return undefined
          if (config?.modelProviderID === nextProvider && config?.modelID && provider.models[config.modelID])
            return config.modelID
          if (provider.models[selectedModelIDRef.current]) return selectedModelIDRef.current
          return modelFallback(catalog, nextProvider)
        })()
        if (nextModel) setSelectedModelID(nextModel)
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [client, config?.modelID, config?.modelProviderID])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const connectedProviders = useMemo(() => new Set(providerCatalog?.connected ?? []), [providerCatalog])
  const visibleProviders = useMemo(() => {
    const providers = [...(providerCatalog?.all ?? [])]
    providers.sort((left, right) => {
      const leftScore = left.id === MOBILE_DEFAULT_PROVIDER_ID ? 3 : connectedProviders.has(left.id) ? 2 : 1
      const rightScore = right.id === MOBILE_DEFAULT_PROVIDER_ID ? 3 : connectedProviders.has(right.id) ? 2 : 1
      if (leftScore !== rightScore) return rightScore - leftScore
      return left.name.localeCompare(right.name)
    })
    const term = providerSearch.trim().toLowerCase()
    if (!term) return providers
    return providers.filter((provider) =>
      [provider.name, provider.id, ...provider.env].some((value) => value.toLowerCase().includes(term)),
    )
  }, [connectedProviders, providerCatalog, providerSearch])

  const selectedProvider = useMemo(
    () => providerCatalog?.all.find((provider) => provider.id === selectedProviderID) ?? null,
    [providerCatalog, selectedProviderID],
  )

  const visibleModels = useMemo(() => {
    if (!selectedProvider) return []
    const models = Object.values(selectedProvider.models)
    const defaultModelID = providerCatalog?.default[selectedProvider.id]
    models.sort((left, right) => {
      const leftDefault = left.id === defaultModelID ? 1 : 0
      const rightDefault = right.id === defaultModelID ? 1 : 0
      if (leftDefault !== rightDefault) return rightDefault - leftDefault
      return left.name.localeCompare(right.name)
    })
    const term = modelSearch.trim().toLowerCase()
    const filtered = !term
      ? models
      : models.filter((model) =>
          [model.name, model.id, model.status].some((value) => value.toLowerCase().includes(term)),
        )
    return filtered.slice(0, 24)
  }, [modelSearch, providerCatalog, selectedProvider])

  const providerConnected = selectedProvider ? connectedProviders.has(selectedProvider.id) : false
  const selectedModel = selectedProvider?.models[selectedModelID] ?? null
  const modelVariants = useMemo(() => listEnabledVariants(selectedModel?.variants), [selectedModel?.variants])

  useEffect(() => {
    if (!selectedProviderID || !selectedModelID) return
    void getModelVariant(selectedProviderID, selectedModelID).then((variant) => {
      setSelectedVariant(variant)
    })
  }, [selectedModelID, selectedProviderID])

  function chooseProvider(providerID: string) {
    setSelectedProviderID(providerID)
    setModelSearch("")
    setSelectedVariant(undefined)
    const nextModel = modelFallback(providerCatalog, providerID)
    if (nextModel) setSelectedModelID(nextModel)
  }

  function chooseModel(modelID: string) {
    setSelectedModelID(modelID)
    setSelectedVariant(undefined)
  }

  async function saveSessionDefaults() {
    if (!config) {
      setMessage("Link a host before saving mobile session defaults")
      return
    }
    try {
      setDefaultsSaving(true)
      setMessage(null)
      await save({
        ...config,
        modelProviderID: selectedProviderID,
        modelID: selectedModelID,
      })
      await setModelVariant(selectedProviderID, selectedModelID, selectedVariant)
      const variantLabel = selectedVariant ? ` (${formatVariantLabel(selectedVariant)})` : ""
      setMessage(`New mobile sessions now start with ${selectedModelID}${variantLabel}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setDefaultsSaving(false)
    }
  }

  async function saveProviderKey() {
    if (!client || !selectedProviderID || !providerKey.trim()) return
    try {
      setSaving(true)
      setMessage(null)
      await client.setProviderApiKey(selectedProviderID, providerKey.trim())
      setProviderKey("")
      await load()
      setMessage(`${selectedProvider?.name ?? selectedProviderID} API key saved on host`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  async function removeProviderKey() {
    if (!client || !selectedProviderID) return
    try {
      setSaving(true)
      setMessage(null)
      await client.removeProviderAuth(selectedProviderID)
      await load()
      setMessage(`${selectedProvider?.name ?? selectedProviderID} credentials removed from host`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: 36 }}
    >
      <Stack.Screen options={{ title: "Models" }} />

      <SurfaceCard
        eyebrow="Provider control plane"
        title="Models and credentials"
        description="Manage provider connectivity, choose the default model for new sessions, and keep host credentials clean."
      >
        <View className="flex-row flex-wrap gap-2">
          <InfoChip
            label={providerConnected ? "Connected on host" : "Needs host auth"}
            tone={providerConnected ? "good" : "warn"}
          />
          <InfoChip label={selectedProvider?.name || selectedProviderID || "Select a provider"} />
          <InfoChip label={selectedModelID || MOBILE_DEFAULT_MODEL_ID} tone="accent" />
          {selectedVariant ? <InfoChip label={formatVariantLabel(selectedVariant)} tone="accent" /> : null}
        </View>
      </SurfaceCard>

      {message ? <ErrorBanner message={message} /> : null}

      {loading ? (
        <View className="items-center rounded-[8px] border border-border bg-background/60 px-4 py-5">
          <ActivityIndicator />
          <Text className="mt-3 text-sm text-soft">Loading providers and model catalog…</Text>
        </View>
      ) : (
        <>
          <SurfaceCard
            eyebrow="Providers"
            title="Select a provider"
            description="Search host providers and focus the one you want to use for future mobile sessions."
          >
            <View className="gap-4">
              <TextField
                label="Providers"
                value={providerSearch}
                onChangeText={setProviderSearch}
                autoCapitalize="none"
                placeholder="Search providers"
              />
              <View className="flex-row flex-wrap gap-2">
                {visibleProviders.map((provider) => {
                  const active = provider.id === selectedProviderID
                  const connected = connectedProviders.has(provider.id)
                  return (
                    <Pressable
                      key={provider.id}
                      onPress={() => chooseProvider(provider.id)}
                      className={`rounded-[18px] border px-3 py-2 ${optionChipClass(active)}`}
                    >
                      <Text className={`text-[12px] font-semibold ${optionChipTextClass(active)}`}>
                        {provider.name}
                      </Text>
                      <Text className={`mt-1 text-[10px] ${active ? "text-accent-light/85" : "text-soft"}`}>
                        {provider.id}
                        {connected ? " - connected" : ""}
                      </Text>
                    </Pressable>
                  )
                })}
              </View>
            </View>
          </SurfaceCard>

          {selectedProvider ? (
            <SurfaceCard eyebrow="Selected provider" title={selectedProvider.name} description={selectedProvider.id}>
              <View className="gap-3">
                {selectedProvider.env.length ? (
                  <Text className="text-sm leading-6 text-soft">Env hints: {selectedProvider.env.join(", ")}</Text>
                ) : null}
                <TextField
                  label="Models"
                  value={modelSearch}
                  onChangeText={setModelSearch}
                  autoCapitalize="none"
                  placeholder="Search models for the selected provider"
                />
                <View className="flex-row flex-wrap gap-2">
                  {visibleModels.map((model) => {
                    const active = model.id === selectedModelID
                    return (
                      <Pressable
                        key={model.id}
                        onPress={() => chooseModel(model.id)}
                        className={`rounded-[18px] border px-3 py-2 ${optionChipClass(active)}`}
                      >
                        <Text className={`text-[12px] font-semibold ${optionChipTextClass(active)}`}>{model.name}</Text>
                        <Text className={`mt-1 text-[10px] uppercase ${active ? "text-accent-light/85" : "text-soft"}`}>
                          {model.status}
                        </Text>
                      </Pressable>
                    )
                  })}
                </View>
                {modelVariants.length > 0 ? (
                  <View className="gap-2">
                    <Text className="text-[12px] font-semibold text-ink">Thinking effort</Text>
                    <View className="flex-row flex-wrap gap-2">
                      <Pressable
                        onPress={() => setSelectedVariant(undefined)}
                        className={`rounded-[18px] border px-3 py-2 ${optionChipClass(!selectedVariant)}`}
                      >
                        <Text className={`text-[12px] font-semibold ${optionChipTextClass(!selectedVariant)}`}>
                          Default
                        </Text>
                      </Pressable>
                      {modelVariants.map((variant) => {
                        const active = selectedVariant === variant
                        return (
                          <Pressable
                            key={variant}
                            onPress={() => setSelectedVariant(variant)}
                            className={`rounded-[18px] border px-3 py-2 ${optionChipClass(active)}`}
                          >
                            <Text className={`text-[12px] font-semibold ${optionChipTextClass(active)}`}>
                              {formatVariantLabel(variant)}
                            </Text>
                          </Pressable>
                        )
                      })}
                    </View>
                  </View>
                ) : null}
                <ActionButton
                  label="Use this model for new mobile sessions"
                  loading={defaultsSaving}
                  disabled={!selectedProviderID || !selectedModelID}
                  onPress={() => void saveSessionDefaults()}
                />
              </View>
            </SurfaceCard>
          ) : null}

          <SurfaceCard
            eyebrow="Provider auth"
            title="Credential management"
            description="Store or remove the selected provider key on the host."
          >
            <View className="gap-3">
              <TextField
                label={`${selectedProvider?.name || selectedProviderID || "Provider"} API key`}
                value={providerKey}
                onChangeText={setProviderKey}
                autoCapitalize="none"
                placeholder="Paste API key"
              />
              <View className="flex-row gap-2">
                <View className="flex-1">
                  <ActionButton
                    label="Save API key"
                    loading={saving}
                    disabled={!selectedProviderID || !providerKey.trim()}
                    onPress={() => void saveProviderKey()}
                  />
                </View>
                <View className="flex-1">
                  <ActionButton
                    label="Remove provider auth"
                    variant="secondary"
                    disabled={!selectedProviderID || saving}
                    onPress={() => void removeProviderKey()}
                  />
                </View>
              </View>
            </View>
          </SurfaceCard>
        </>
      )}
    </ScrollView>
  )
}
