import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native"
import * as WebBrowser from "expo-web-browser"
import { useFocusEffect } from "expo-router"
import { ActionButton } from "@/components/ui/ActionButton"
import { ErrorBanner } from "@/components/ui/ErrorBanner"
import { InfoChip } from "@/components/ui/InfoChip"
import { SurfaceCard } from "@/components/ui/SurfaceCard"
import { TextField } from "@/components/ui/TextField"
import { useServer } from "@/lib/server-provider"
import {
  MOBILE_DEFAULT_MODEL_ID,
  MOBILE_DEFAULT_PROVIDER_ID,
  type GitHubDeviceAuthStart,
  type MobileExecutionTarget,
  type ProviderCatalog,
} from "@/lib/types"

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function maybeHandle(message: string | null) {
  return message ? <ErrorBanner message={message} /> : null
}

function optionChipClass(active: boolean) {
  return active ? "border-accent/30 bg-accent/12" : "border-border bg-background/70"
}

function optionChipTextClass(active: boolean) {
  return active ? "text-accent-light" : "text-ink"
}

function providerFallback(catalog: ProviderCatalog | null) {
  if (!catalog?.all.length) return MOBILE_DEFAULT_PROVIDER_ID
  if (catalog.all.some((provider) => provider.id === MOBILE_DEFAULT_PROVIDER_ID)) {
    return MOBILE_DEFAULT_PROVIDER_ID
  }
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

export default function SettingsScreen() {
  const { client, config, bootstrap, bootstrapLoading, refreshBootstrap, save, clear } = useServer()
  const [url, setUrl] = useState(config?.url ?? "")
  const [token, setToken] = useState(config?.token ?? "")
  const [directory, setDirectory] = useState(config?.directory ?? "")
  const [selectedExecutionTarget, setSelectedExecutionTarget] = useState<MobileExecutionTarget>(
    config?.executionTarget ?? "local",
  )
  const [providerCatalog, setProviderCatalog] = useState<ProviderCatalog | null>(null)
  const [providerSearch, setProviderSearch] = useState("")
  const [modelSearch, setModelSearch] = useState("")
  const [selectedProviderID, setSelectedProviderID] = useState(config?.modelProviderID ?? MOBILE_DEFAULT_PROVIDER_ID)
  const [selectedModelID, setSelectedModelID] = useState(config?.modelID ?? MOBILE_DEFAULT_MODEL_ID)
  const [providerKey, setProviderKey] = useState("")
  const [githubToken, setGithubToken] = useState("")
  const [saving, setSaving] = useState(false)
  const [providerLoading, setProviderLoading] = useState(false)
  const [providerSaving, setProviderSaving] = useState(false)
  const [defaultsSaving, setDefaultsSaving] = useState(false)
  const [oauthBusy, setOauthBusy] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [oauthFlow, setOauthFlow] = useState<GitHubDeviceAuthStart | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const authRun = useRef(0)

  useEffect(() => {
    setUrl(config?.url ?? "")
    setToken(config?.token ?? "")
    setDirectory(config?.directory ?? "")
    setSelectedExecutionTarget(config?.executionTarget ?? "local")
    setSelectedProviderID(config?.modelProviderID ?? MOBILE_DEFAULT_PROVIDER_ID)
    setSelectedModelID(config?.modelID ?? MOBILE_DEFAULT_MODEL_ID)
  }, [config])

  const loadProviderData = useCallback(async () => {
    if (!client) {
      setProviderCatalog(null)
      return
    }

    try {
      setProviderLoading(true)
      const catalog = await client.listProviders()
      setProviderCatalog(catalog)

      const nextProvider = (() => {
        if (config?.modelProviderID && catalog.all.some((item) => item.id === config.modelProviderID)) {
          return config.modelProviderID
        }
        if (catalog.all.some((item) => item.id === selectedProviderID)) return selectedProviderID
        return providerFallback(catalog)
      })()

      if (nextProvider) {
        setSelectedProviderID(nextProvider)
        const nextModel = (() => {
          const provider = catalog.all.find((item) => item.id === nextProvider)
          if (!provider) return undefined
          if (config?.modelProviderID === nextProvider && config?.modelID && provider.models[config.modelID]) {
            return config.modelID
          }
          if (provider.models[selectedModelID]) return selectedModelID
          return modelFallback(catalog, nextProvider)
        })()
        if (nextModel) setSelectedModelID(nextModel)
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setProviderLoading(false)
    }
  }, [client, config?.modelID, config?.modelProviderID, selectedModelID, selectedProviderID])

  useFocusEffect(
    useCallback(() => {
      setMessage(null)
      void loadProviderData()
    }, [loadProviderData]),
  )

  async function saveConnection() {
    const nextUrl = url.trim()
    if (!nextUrl) {
      setMessage("Host URL is required")
      return
    }

    if (selectedExecutionTarget === "container" && !bootstrap?.execution?.container?.available) {
      setMessage("Container sandbox requires Docker or Podman on the Nikcli host")
      return
    }

    try {
      setSaving(true)
      setMessage(null)
      await save({
        ...config,
        url: nextUrl,
        token: token.trim() || undefined,
        directory: directory.trim() || undefined,
        modelProviderID: selectedProviderID,
        modelID: selectedModelID,
        executionTarget: selectedExecutionTarget,
      })
      setMessage("Host connection updated")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  async function syncBootstrap(messageText?: string) {
    await refreshBootstrap().catch(() => null)
    if (messageText) setMessage(messageText)
  }

  async function waitForApproval(flow: GitHubDeviceAuthStart, runID: number) {
    let interval = flow.interval
    while (Date.now() < flow.expiresAt && authRun.current === runID) {
      await sleep(interval * 1000)
      if (authRun.current !== runID || !client) return
      const result = await client.pollGithubDeviceAuth(flow.deviceCode)
      if (result.status === "pending") {
        interval = result.interval ?? interval
        continue
      }
      if (result.status === "approved") {
        authRun.current = 0
        setOauthFlow(null)
        await syncBootstrap(`GitHub connected as @${result.user?.login}`)
        return
      }
      if (result.status === "denied") {
        authRun.current = 0
        setOauthFlow(null)
        setMessage("GitHub authorization was denied")
        return
      }
      if (result.status === "expired") {
        authRun.current = 0
        setOauthFlow(null)
        setMessage("GitHub authorization expired. Start a new sign-in.")
        return
      }
    }
    if (authRun.current === runID) {
      authRun.current = 0
      setOauthFlow(null)
      setMessage("GitHub authorization expired. Start a new sign-in.")
    }
  }

  async function startGithubOAuth() {
    if (!client) return
    try {
      setOauthBusy(true)
      setMessage(null)
      const flow = await client.startGithubDeviceAuth()
      const runID = Date.now()
      authRun.current = runID
      setOauthFlow(flow)
      void WebBrowser.openBrowserAsync(flow.verificationUriComplete || flow.verificationUri)
      void waitForApproval(flow, runID)
      setMessage("Approve GitHub in your browser. The app is waiting for confirmation.")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setOauthBusy(false)
    }
  }

  async function checkGithubApproval() {
    if (!client || !oauthFlow) return
    try {
      setOauthBusy(true)
      const result = await client.pollGithubDeviceAuth(oauthFlow.deviceCode)
      if (result.status === "approved") {
        authRun.current = 0
        setOauthFlow(null)
        await syncBootstrap(`GitHub connected as @${result.user?.login}`)
        return
      }
      if (result.status === "pending") {
        setMessage("Still waiting for GitHub approval.")
        return
      }
      if (result.status === "denied") {
        authRun.current = 0
        setOauthFlow(null)
        setMessage("GitHub authorization was denied")
        return
      }
      authRun.current = 0
      setOauthFlow(null)
      setMessage("GitHub authorization expired. Start a new sign-in.")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setOauthBusy(false)
    }
  }

  async function connectGithubWithToken() {
    if (!client || !githubToken.trim()) return
    try {
      setSaving(true)
      await client.setGithubToken(githubToken.trim())
      setGithubToken("")
      await syncBootstrap("GitHub token saved on host")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  async function disconnectGithub() {
    if (!client) return
    try {
      setSaving(true)
      authRun.current = 0
      setOauthFlow(null)
      await client.clearGithubToken()
      await syncBootstrap("GitHub access removed from host")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const githubConnected = Boolean(bootstrap?.github?.connected)
  const containerReady = Boolean(bootstrap?.execution?.container?.available)
  const containerRuntime = bootstrap?.execution?.container?.runtime

  async function forgetHost() {
    authRun.current = 0
    setOauthFlow(null)
    await clear()
    setMessage("Host configuration removed from this device")
  }

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
      setMessage(`New mobile sessions now start with ${selectedModelID}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setDefaultsSaving(false)
    }
  }

  async function saveProviderKey() {
    if (!client || !selectedProviderID || !providerKey.trim()) return

    try {
      setProviderSaving(true)
      setMessage(null)
      await client.setProviderApiKey(selectedProviderID, providerKey.trim())
      setProviderKey("")
      await loadProviderData()
      setMessage(`${selectedProvider?.name ?? selectedProviderID} API key saved on host`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setProviderSaving(false)
    }
  }

  async function removeProviderKey() {
    if (!client || !selectedProviderID) return

    try {
      setProviderSaving(true)
      setMessage(null)
      await client.removeProviderAuth(selectedProviderID)
      await loadProviderData()
      setMessage(`${selectedProvider?.name ?? selectedProviderID} credentials removed from host`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setProviderSaving(false)
    }
  }

  function chooseProvider(providerID: string) {
    setSelectedProviderID(providerID)
    setModelSearch("")
    const nextModel = modelFallback(providerCatalog, providerID)
    if (nextModel) setSelectedModelID(nextModel)
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: 36 }}
    >
      <SurfaceCard
        eyebrow="Operator trust"
        title="Harden host access and GitHub identity."
        description="Keep the control plane clean: one trusted host, one verified GitHub identity, and one clear path from prompt to pull request."
      >
        <View className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-accent/15" />
        <View className="absolute bottom-0 left-0 h-20 w-full bg-panel/25" />
        <View className="flex-row flex-wrap gap-2">
          <InfoChip label={config ? "Host linked" : "Host offline"} tone={config ? "good" : "warn"} />
          <InfoChip
            label={
              githubConnected ? `GitHub @${bootstrap?.github?.user?.login || "connected"}` : "GitHub not connected"
            }
            tone={githubConnected ? "good" : "warn"}
          />
          <InfoChip
            label={selectedExecutionTarget === "container" ? "GitHub target: container" : "GitHub target: local"}
            tone={selectedExecutionTarget === "container" ? "accent" : "neutral"}
          />
          <InfoChip label={bootstrapLoading ? "Refreshing control plane" : "Control plane ready"} />
        </View>
      </SurfaceCard>

      {maybeHandle(message)}

      <SurfaceCard
        eyebrow="Host connection"
        title="Primary endpoint"
        description="This endpoint is the execution backbone for sessions, worktrees, approvals, and GitHub publishing."
        tone="panel"
      >
        <View className="gap-3">
          <TextField
            label="Host URL"
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            placeholder="https://your-host.example.com"
          />
          <TextField
            label="Bearer token"
            value={token}
            onChangeText={setToken}
            autoCapitalize="none"
            placeholder="Bearer token"
          />
          <TextField
            label="Default host directory"
            value={directory}
            onChangeText={setDirectory}
            autoCapitalize="none"
            placeholder="Default host directory"
          />
          <View className="flex-row gap-2">
            <View className="flex-1">
              <ActionButton label="Save connection" loading={saving} onPress={() => void saveConnection()} />
            </View>
            <View className="flex-1">
              <ActionButton
                label="Forget host"
                variant="secondary"
                disabled={saving}
                onPress={() => void forgetHost()}
              />
            </View>
          </View>
        </View>
      </SurfaceCard>

      <SurfaceCard
        eyebrow="GitHub execution"
        title="Choose where GitHub sessions run"
        description="Keep the current local worktree flow or launch GitHub sessions inside a same-host container sandbox while preserving the existing mobile structure."
      >
        <View className="flex-row flex-wrap gap-2">
          <InfoChip
            label={
              containerReady
                ? `Container ready${containerRuntime ? ` (${containerRuntime})` : ""}`
                : "Container unavailable"
            }
            tone={containerReady ? "good" : "warn"}
          />
          <InfoChip
            label={selectedExecutionTarget === "container" ? "Container sandbox" : "Local worktree"}
            tone="accent"
          />
        </View>

        <View className="mt-4 flex-row gap-2">
          <Pressable
            onPress={() => setSelectedExecutionTarget("local")}
            className={`min-w-0 flex-1 rounded-[18px] border px-3 py-3 ${optionChipClass(selectedExecutionTarget === "local")}`}
          >
            <Text className={`text-sm font-semibold ${optionChipTextClass(selectedExecutionTarget === "local")}`}>
              Local worktree
            </Text>
            <Text className="mt-1 text-xs leading-5 text-soft">
              Same behavior as now: host repo, host git, fastest path to publish.
            </Text>
          </Pressable>

          <Pressable
            onPress={() => {
              if (containerReady) setSelectedExecutionTarget("container")
            }}
            disabled={!containerReady}
            className={`min-w-0 flex-1 rounded-[18px] border px-3 py-3 ${optionChipClass(selectedExecutionTarget === "container")}`}
          >
            <Text className={`text-sm font-semibold ${optionChipTextClass(selectedExecutionTarget === "container")}`}>
              Container sandbox
            </Text>
            <Text className="mt-1 text-xs leading-5 text-soft">
              Runs GitHub session execution inside a same-host container while keeping the worktree publish flow.
            </Text>
          </Pressable>
        </View>

        <Text className="mt-3 text-xs leading-5 text-soft">
          {containerReady
            ? "Recommended when you want stronger execution isolation without changing how PRs and cleanup work."
            : "Install Docker or Podman on the host to unlock container-backed GitHub sessions."}
        </Text>
      </SurfaceCard>

      <SurfaceCard
        eyebrow="Mobile AI"
        title="Providers and new-session model"
        description="Connect a provider on the host, then choose the model used on the first prompt of every new mobile session. The recommended preset is already pinned to MiniMax coding plan."
      >
        {providerLoading ? (
          <View className="items-center rounded-[24px] border border-border bg-background/60 px-4 py-5">
            <ActivityIndicator color="#7dd3fc" />
            <Text className="mt-3 text-sm text-soft">Loading providers and model catalog…</Text>
          </View>
        ) : (
          <View className="gap-4">
            <View className="flex-row flex-wrap gap-2">
              <InfoChip
                label={providerConnected ? "Connected on host" : "Needs host auth"}
                tone={providerConnected ? "good" : "warn"}
              />
              <InfoChip label={selectedProvider?.name || selectedProviderID || "Select a provider"} />
              <InfoChip label={selectedModelID || MOBILE_DEFAULT_MODEL_ID} tone="accent" />
            </View>

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
                    <Text className={`text-[12px] font-semibold ${optionChipTextClass(active)}`}>{provider.name}</Text>
                    <Text className={`mt-1 text-[10px] ${active ? "text-accent-light/85" : "text-soft"}`}>
                      {provider.id}
                      {connected ? " - connected" : ""}
                    </Text>
                  </Pressable>
                )
              })}
            </View>

            {selectedProvider ? (
              <View className="rounded-[24px] border border-border bg-background/60 px-4 py-4">
                <Text className="text-[11px] font-semibold uppercase tracking-[1.8px] text-accent-light">
                  Selected provider
                </Text>
                <Text className="mt-2 text-lg font-semibold text-ink">{selectedProvider.name}</Text>
                <Text className="mt-1 text-sm text-soft">{selectedProvider.id}</Text>
                {selectedProvider.env.length ? (
                  <Text className="mt-3 text-sm leading-6 text-soft">Env hints: {selectedProvider.env.join(", ")}</Text>
                ) : null}
              </View>
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
                    onPress={() => setSelectedModelID(model.id)}
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

            <ActionButton
              label="Use this model for new mobile sessions"
              loading={defaultsSaving}
              disabled={!selectedProviderID || !selectedModelID}
              onPress={() => void saveSessionDefaults()}
            />

            <View className="rounded-[24px] border border-border bg-panel/55 px-4 py-4">
              <Text className="text-[11px] font-semibold uppercase tracking-[1.8px] text-accent-light">
                Provider API key
              </Text>
              <Text className="mt-2 text-sm leading-6 text-soft">
                Save the key on the host for the selected provider. This is what unlocks providers like MiniMax for
                mobile-created sessions.
              </Text>
              <View className="mt-3 gap-3">
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
                      loading={providerSaving}
                      disabled={!selectedProviderID || !providerKey.trim()}
                      onPress={() => void saveProviderKey()}
                    />
                  </View>
                  <View className="flex-1">
                    <ActionButton
                      label="Remove provider auth"
                      variant="secondary"
                      disabled={!selectedProviderID || providerSaving}
                      onPress={() => void removeProviderKey()}
                    />
                  </View>
                </View>
              </View>
            </View>
          </View>
        )}
      </SurfaceCard>

      <SurfaceCard
        eyebrow="GitHub enterprise access"
        title="OAuth device sign-in"
        description="Sign in with GitHub through the browser, then let the host reuse that identity for repo import, branch worktrees, and PR creation."
      >
        {bootstrap?.github?.oauthDeviceEnabled ? (
          <ActionButton
            label={githubConnected ? "Reconnect with GitHub OAuth" : "Connect with GitHub OAuth"}
            loading={oauthBusy}
            onPress={() => void startGithubOAuth()}
          />
        ) : (
          <View className="rounded-[24px] border border-danger/30 bg-danger/10 px-4 py-4">
            <Text className="text-sm leading-6 text-rose-200">
              GitHub OAuth is not enabled on this host. Add `NIKCLI_GITHUB_OAUTH_CLIENT_ID` or
              `GITHUB_CLIENT_ID_CONSOLE` to the host environment running Nikcli, then restart that host process.
            </Text>
          </View>
        )}

        {githubConnected ? (
          <View className="mt-4 rounded-[26px] border border-success/20 bg-success/10 px-4 py-4">
            <Text className="text-[11px] font-semibold uppercase tracking-[1.8px] text-emerald-200">
              Connected account
            </Text>
            <Text className="mt-2 text-xl font-semibold text-ink">@{bootstrap?.github?.user?.login}</Text>
            {bootstrap?.github?.user?.name ? (
              <Text className="mt-1 text-sm text-soft">{bootstrap.github.user.name}</Text>
            ) : null}
            <View className="mt-4">
              <ActionButton
                label="Disconnect GitHub"
                variant="secondary"
                disabled={saving}
                onPress={() => void disconnectGithub()}
              />
            </View>
          </View>
        ) : null}

        {oauthFlow ? (
          <View className="mt-4 rounded-[26px] border border-border bg-background/60 px-4 py-4">
            <Text className="text-[11px] font-semibold uppercase tracking-[1.8px] text-accent-light">
              Authorization in progress
            </Text>
            <Text className="mt-2 text-sm leading-6 text-soft">
              Enter this code in GitHub if the browser page asks for it.
            </Text>
            <View className="mt-3 rounded-2xl border border-accent/20 bg-accent/10 px-4 py-4">
              <Text className="text-center text-[28px] font-semibold tracking-[6px] text-ink">
                {oauthFlow.userCode}
              </Text>
            </View>
            <View className="mt-3 flex-row gap-2">
              <View className="flex-1">
                <ActionButton
                  label="Open GitHub"
                  onPress={() =>
                    void WebBrowser.openBrowserAsync(oauthFlow.verificationUriComplete || oauthFlow.verificationUri)
                  }
                />
              </View>
              <View className="flex-1">
                <ActionButton
                  label="Check approval"
                  variant="secondary"
                  loading={oauthBusy}
                  onPress={() => void checkGithubApproval()}
                />
              </View>
            </View>
          </View>
        ) : null}
      </SurfaceCard>

      <SurfaceCard
        eyebrow="Advanced fallback"
        title="Manual token access"
        description="Use only when OAuth is unavailable or when you need a dedicated service token for a hardened environment."
        tone="panel"
      >
        <View className="flex-row flex-wrap gap-2">
          <InfoChip label={advancedOpen ? "Expanded" : "Hidden"} tone={advancedOpen ? "accent" : "neutral"} />
          <InfoChip label="Stored on host" />
        </View>
        <View className="mt-4">
          <ActionButton
            label={advancedOpen ? "Hide manual token form" : "Show manual token form"}
            variant="secondary"
            onPress={() => setAdvancedOpen((value) => !value)}
          />
        </View>

        {advancedOpen ? (
          <View className="mt-4 gap-3">
            <TextField
              value={githubToken}
              onChangeText={setGithubToken}
              autoCapitalize="none"
              placeholder="ghp_..."
              label="GitHub token"
            />
            <ActionButton
              label="Save manual GitHub token"
              variant="secondary"
              loading={saving}
              disabled={!githubToken.trim()}
              onPress={() => void connectGithubWithToken()}
            />
          </View>
        ) : null}
      </SurfaceCard>

      {bootstrapLoading ? (
        <View className="items-center rounded-[24px] border border-border bg-surface px-4 py-4">
          <ActivityIndicator color="#7dd3fc" />
          <Text className="mt-3 text-sm text-soft">Refreshing host and GitHub posture…</Text>
        </View>
      ) : null}
    </ScrollView>
  )
}
