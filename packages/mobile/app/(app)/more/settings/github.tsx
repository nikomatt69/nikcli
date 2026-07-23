import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ScrollView, Text, View } from "react-native"
import * as WebBrowser from "expo-web-browser"
import { Stack, useFocusEffect } from "expo-router"
import { ActionButton } from "@/components/ui/ActionButton"
import { ErrorBanner } from "@/components/ui/ErrorBanner"
import { InfoChip } from "@/components/ui/InfoChip"
import { SurfaceCard } from "@/components/ui/SurfaceCard"
import { TextField } from "@/components/ui/TextField"
import { useServer } from "@/lib/server-context"
import { type GitHubDeviceAuthStart, type HostConfigSnapshot } from "@/lib/types"

function githubConnectorKey(snapshot: HostConfigSnapshot | null) {
  const entries = Object.entries(snapshot?.connectors ?? {})
  const existing = entries.find(([, value]) => value?.type === "github")
  return existing?.[0] ?? "github"
}

function githubConnector(snapshot: HostConfigSnapshot | null) {
  const key = githubConnectorKey(snapshot)
  const connector = snapshot?.connectors?.[key]
  return typeof connector === "object" && connector !== null ? connector : undefined
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export default function GithubSettingsScreen() {
  const { client, bootstrap, refreshBootstrap } = useServer()
  const [hostConfig, setHostConfig] = useState<HostConfigSnapshot | null>(null)
  const [githubToken, setGithubToken] = useState("")
  const [githubOauthClientID, setGithubOauthClientID] = useState("")
  const [oauthBusy, setOauthBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [oauthFlow, setOauthFlow] = useState<GitHubDeviceAuthStart | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const authRun = useRef(0)
  // Cancel any in-flight polling loop on unmount
  useEffect(
    () => () => {
      authRun.current = -1
    },
    [],
  )

  const githubConnected = Boolean(bootstrap?.github?.connected)
  const oauthConfigured = Boolean(bootstrap?.github?.oauthDeviceConfigured)
  const githubTokenAvailable = Boolean(bootstrap?.github?.tokenAvailable)
  const reconnectRequired = Boolean(bootstrap?.github?.reconnectRequired)

  const load = useCallback(async () => {
    if (!client) return
    try {
      const nextConfig = await client.getConfig()
      setHostConfig(nextConfig)
      const connector = githubConnector(nextConfig)
      const oauthClientID =
        typeof connector?.oauthClientId === "string"
          ? connector.oauthClientId
          : typeof connector?.clientId === "string"
            ? connector.clientId
            : ""
      setGithubOauthClientID(oauthClientID)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }, [client])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const profileChips = useMemo(
    () => [
      oauthConfigured ? "OAuth ready" : "OAuth needs client ID",
      bootstrap?.github?.oauthClientSource ? `Source ${bootstrap.github.oauthClientSource}` : "Source host setup",
      githubTokenAvailable ? "GH token stored" : "GH token missing",
      githubConnected ? "GitHub linked" : reconnectRequired ? "Reconnect needed" : "GitHub offline",
    ],
    [bootstrap?.github?.oauthClientSource, githubConnected, githubTokenAvailable, oauthConfigured, reconnectRequired],
  )

  async function syncBootstrap(messageText?: string) {
    await refreshBootstrap().catch(() => null)
    await load().catch(() => null)
    if (messageText) setMessage(messageText)
  }

  async function persistGithubOAuthClientID() {
    if (!client) return null
    const value = githubOauthClientID.trim()
    if (!value) {
      setMessage("GitHub OAuth client ID is required")
      return null
    }

    try {
      setSaving(true)
      setMessage(null)
      const nextConfig = await client.saveGithubOAuthClientID(value)
      setHostConfig(nextConfig)
      await syncBootstrap("GitHub OAuth client ID saved globally on host")
      return nextConfig
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
      return null
    } finally {
      setSaving(false)
    }
  }

  async function waitForApproval(flow: GitHubDeviceAuthStart, runID: number) {
    if (!client) return
    const host = client
    const abort = () => authRun.current !== runID || !client
    let interval = flow.interval
    while (!abort() && Date.now() < flow.expiresAt) {
      await sleep(interval * 1000)
      if (abort()) return
      let result: Awaited<ReturnType<typeof host.pollGithubDeviceAuth>>
      try {
        result = await host.pollGithubDeviceAuth(flow.deviceCode)
      } catch (cause) {
        // Network/server failure mid-poll: surface a message and unblock the UI
        // so the user can retry. Without this try/catch the rejection was
        // unhandled and authRun stayed pinned, leaving the sheet unclosable.
        authRun.current = 0
        setOauthFlow(null)
        setMessage(
          cause instanceof Error
            ? `GitHub sign-in interrupted: ${cause.message}`
            : "GitHub sign-in was interrupted by a network error. Try again.",
        )
        return
      }
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
  }

  async function startGithubOAuth() {
    if (!client) return
    if (!oauthConfigured) {
      const saved = await persistGithubOAuthClientID()
      if (!saved) return
    }

    try {
      setOauthBusy(true)
      setMessage(null)
      const flow = await client.startGithubDeviceAuth()
      authRun.current += 1
      const runID = authRun.current
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
      authRun.current = 0
      setOauthFlow(null)
      setMessage(
        result.status === "denied"
          ? "GitHub authorization was denied"
          : "GitHub authorization expired. Start a new sign-in.",
      )
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

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: 36 }}
    >
      <Stack.Screen options={{ title: "GitHub" }} />

      <SurfaceCard
        eyebrow="GitHub enterprise access"
        title="OAuth and account trust"
        description="Sign in with GitHub through the device flow, manage the host OAuth client ID, and keep fallback token access available when needed."
      >
        <View className="flex-row flex-wrap gap-2">
          {profileChips.map((chip) => (
            <InfoChip
              key={chip}
              label={chip}
              tone={
                chip.includes("ready") || chip.includes("linked") || chip.includes("stored")
                  ? "good"
                  : chip.includes("needs") || chip.includes("offline") || chip.includes("missing")
                    ? "warn"
                    : "neutral"
              }
            />
          ))}
        </View>
      </SurfaceCard>

      {message ? <ErrorBanner message={message} /> : null}

      {reconnectRequired ? (
        <View className="rounded-[8px] border border-danger/30 bg-danger/10 p-4 gap-3">
          <Text className="text-sm font-medium text-ink">GitHub session expired</Text>
          <Text className="text-sm leading-6 text-soft">
            Your stored GitHub access expired and couldn't refresh automatically. Reconnect to keep repo import,
            branches, and pull requests working.
          </Text>
          <ActionButton label="Reconnect GitHub" loading={oauthBusy} onPress={() => void startGithubOAuth()} />
        </View>
      ) : null}

      <SurfaceCard
        eyebrow="OAuth device sign-in"
        title="Primary GitHub path"
        description="Keep OAuth always available by saving the client ID on the host and using the browser-based device authorization flow."
      >
        <View className="gap-3">
          <TextField
            label="GitHub OAuth client ID"
            value={githubOauthClientID}
            onChangeText={setGithubOauthClientID}
            autoCapitalize="none"
            placeholder="Iv1.1234567890abcdef"
          />
          <View className="flex-row gap-2">
            <View className="flex-1">
              <ActionButton
                label={oauthConfigured ? "Update OAuth client ID" : "Save OAuth client ID"}
                loading={saving}
                onPress={() => void persistGithubOAuthClientID()}
              />
            </View>
            <View className="flex-1">
              <ActionButton
                label={githubConnected ? "Reconnect with GitHub OAuth" : "Connect with GitHub OAuth"}
                loading={oauthBusy}
                variant="secondary"
                onPress={() => void startGithubOAuth()}
              />
            </View>
          </View>

          {!oauthConfigured ? (
            <View className="rounded-[8px] border border-danger/30 bg-danger/10 p-4">
              <Text className="text-sm leading-6 text-ink">
                Save a GitHub OAuth client ID here or configure it on the host with `connectors.github.oauthClientId`,
                `NIKCLI_GITHUB_OAUTH_CLIENT_ID`, or `GITHUB_CLIENT_ID_CONSOLE`.
              </Text>
            </View>
          ) : null}

          {oauthFlow ? (
            <View className="rounded-[8px] border border-border bg-background/60 p-4">
              <Text className="text-[12px] font-medium text-muted">Authorization in progress</Text>
              <Text className="mt-2 text-sm leading-6 text-soft">
                Enter this code in GitHub if the browser page asks for it.
              </Text>
              <View className="mt-3 rounded-2xl border border-accent/20 bg-accent/10 p-4">
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
        </View>
      </SurfaceCard>

      <SurfaceCard
        eyebrow="Connected account"
        title={bootstrap?.github?.user?.login ? `@${bootstrap.github.user.login}` : "No linked account"}
        description={
          bootstrap?.github?.user?.name ||
          "Connect GitHub to unlock repo import, branch worktrees, and publish workflows."
        }
      >
        <View className="gap-3">
          {githubConnected ? (
            <ActionButton
              label="Disconnect GitHub"
              variant="secondary"
              disabled={saving}
              onPress={() => void disconnectGithub()}
            />
          ) : null}
        </View>
      </SurfaceCard>

      <SurfaceCard
        eyebrow="Manual fallback"
        title="Service token access"
        description="Use a dedicated token only when OAuth is not available or when the host is intentionally hardened around PAT-based access."
        tone="panel"
      >
        <View className="gap-3">
          <TextField
            label="GitHub token"
            value={githubToken}
            onChangeText={setGithubToken}
            autoCapitalize="none"
            placeholder="ghp_..."
          />
          <ActionButton
            label="Save manual GitHub token"
            variant="secondary"
            loading={saving}
            disabled={!githubToken.trim()}
            onPress={() => void connectGithubWithToken()}
          />
        </View>
      </SurfaceCard>
    </ScrollView>
  )
}
