import { createMemo, createSignal } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { map, pipe, entries, sortBy } from "remeda"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useTheme } from "../context/theme"
import { Keybind } from "@/util/keybind"
import { TextAttributes } from "@opentui/core"
import { useSDK } from "@tui/context/sdk"
import { useDialog } from "@tui/ui/dialog"
import { DialogPrompt } from "../ui/dialog-prompt"
import { useToast } from "../ui/toast"
import type { Config } from "@/config/config"
import { Connectors } from "@/connectors"

type ConnectorEntry = NonNullable<NonNullable<ReturnType<typeof useSync>["data"]["config"]>["connectors"]>[string]

const DEFAULT_CONNECTORS = [
  { name: "figma", type: "figma" as const, description: "Design files and components" },
  { name: "slack", type: "slack" as const, description: "Messages and channels" },
  { name: "github", type: "github" as const, description: "Repositories and issues" },
  { name: "lovable", type: "lovable" as const, description: "AI projects and chats" },
]

function Status(props: { enabled: boolean; configured: boolean; status?: string; loading: boolean }) {
  const { theme } = useTheme()
  if (props.loading) {
    return <span style={{ fg: theme.textMuted }}>⋯ Loading</span>
  }
  if (!props.configured) {
    return <span style={{ fg: theme.textMuted }}>○ Not configured</span>
  }
  if (!props.enabled) {
    return <span style={{ fg: theme.textMuted }}>○ Disabled</span>
  }
  if (props.status === "needs_auth") {
    return <span style={{ fg: theme.warning }}>⚠ Needs auth</span>
  }
  if (props.status === "failed") {
    return <span style={{ fg: theme.error }}>✗ Failed</span>
  }
  return <span style={{ fg: theme.success, attributes: TextAttributes.BOLD }}>✓ Enabled</span>
}

function authConfigForType(type: string) {
  switch (type) {
    case "slack":
      return { title: "Slack bot token", placeholder: "xoxb-...", field: "botToken" as const }
    case "lovable":
      return { title: "Lovable API key", placeholder: "lvb_...", field: "apiKey" as const }
    case "figma":
      return { title: "Figma personal access token", placeholder: "figma_...", field: "token" as const }
    case "github":
      return { title: "GitHub personal access token", placeholder: "ghp_...", field: "token" as const }
    default:
      return { title: "Connector token", placeholder: "token", field: "token" as const }
  }
}

export function DialogConnectors() {
  const local = useLocal()
  const sync = useSync()
  const sdk = useSDK()
  const dialog = useDialog()
  const toast = useToast()
  const [loading, setLoading] = createSignal<string | null>(null)
  const reopen = () => setTimeout(() => dialog.replace(() => <DialogConnectors />), 0)

  async function refreshStatus() {
    const status = await sdk.client.connectors.status()
    if (status.data) {
      sync.set("connectors", status.data)
    }
  }

  async function addConnectorWithPreset(name: string, type: string) {
    const nextConfig = {
      ...sync.data.config,
      connectors: {
        ...(sync.data.config.connectors ?? {}),
        [name]: {
          type,
          enabled: true,
        },
      },
    }
    await sdk.client.config.update({ config: { connectors: nextConfig.connectors } })
    sync.set("config", nextConfig)
    await refreshStatus()
  }

  async function openAuth(name: string, presetType?: string) {
    const entry = sync.data.config.connectors?.[name]
    const resolvedType = entry && Connectors.isConnectorConfigured(entry) ? entry.type : presetType
    if (!resolvedType) {
      toast.show({
        variant: "warning",
        message: `Connector not found: ${name}`,
        duration: 3000,
      })
      return
    }
    const auth = authConfigForType(resolvedType)
    const value = await DialogPrompt.show(dialog, auth.title, {
      placeholder: auth.placeholder,
    })
    if (!value) {
      if (value === "") {
        toast.show({
          variant: "warning",
          message: "Credential is required",
          duration: 3000,
        })
      }
      reopen()
      return
    }
    if (!entry || !Connectors.isConnectorConfigured(entry)) {
      await addConnectorWithPreset(name, resolvedType)
    }
    await local.connectors.auth(name, { [auth.field]: value })
    await refreshStatus()
    reopen()
  }

  async function logout(name: string) {
    const entry = sync.data.config.connectors?.[name]
    if (!entry || !Connectors.isConnectorConfigured(entry)) {
      toast.show({
        variant: "warning",
        message: `Connector not found: ${name}`,
        duration: 3000,
      })
      return
    }
    await local.connectors.logout(name)
    await refreshStatus()
  }

  async function selectConnectorType() {
    return new Promise<string | null>((resolve) => {
      dialog.replace(
        () => (
          <DialogSelect
            title="Select connector type"
            options={[
              { title: "Figma", value: "figma", description: "Design files and components" },
              { title: "Slack", value: "slack", description: "Messages and channels" },
              { title: "GitHub", value: "github", description: "Repositories and issues" },
              { title: "Lovable", value: "lovable", description: "AI projects and chats" },
            ]}
            onSelect={(option) => resolve(option.value)}
          />
        ),
        () => resolve(null),
      )
    })
  }

  async function addConnector() {
    const name = await DialogPrompt.show(dialog, "Connector name", {
      placeholder: "my-connector",
    })
    if (!name) {
      reopen()
      return
    }
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)) {
      toast.show({
        variant: "warning",
        message: "Name must be alphanumeric (letters, numbers, _, -)",
        duration: 3000,
      })
      reopen()
      return
    }
    const existing = sync.data.config.connectors?.[name]
    if (existing && Connectors.isConnectorConfigured(existing)) {
      toast.show({
        variant: "warning",
        message: `Connector already exists: ${name}`,
        duration: 3000,
      })
      reopen()
      return
    }

    const type = await selectConnectorType()
    if (!type) {
      reopen()
      return
    }

    const nextConfig = {
      ...sync.data.config,
      connectors: {
        ...(sync.data.config.connectors ?? {}),
        [name]: {
          type,
          enabled: true,
        },
      },
    }
    await sdk.client.config.update({ config: { connectors: nextConfig.connectors } })
    sync.set("config", nextConfig)
    await refreshStatus()
    reopen()
  }

  const options = createMemo(() => {
    const config = sync.data.config.connectors ?? {}
    const statusMap = sync.data.connectors ?? {}
    const loadingName = loading()

    const configured = pipe(
      config,
      entries(),
      sortBy(([name]) => name),
      map(([name, entry]) => {
        if (!Connectors.isConnectorConfigured(entry)) return undefined
        const status = statusMap[name]
        const enabled = entry.enabled !== false
        const description = status?.status ?? (enabled ? "not initialized" : "disabled")
        return {
          value: name,
          title: name,
          description,
          footer: <Status enabled={enabled} configured={true} loading={loadingName === name} status={status?.status} />,
          category: entry.type,
        } satisfies DialogSelectOption<string>
      }),
    ).filter(Boolean) as DialogSelectOption<string>[]

    const missingDefaults = DEFAULT_CONNECTORS.filter((item) => {
      const entry = config[item.name]
      return !entry || !Connectors.isConnectorConfigured(entry)
    }).map(
      (item) =>
        ({
          value: item.name,
          title: item.name,
          description: item.description,
          footer: <Status enabled={false} configured={false} loading={loadingName === item.name} status={undefined} />,
          category: item.type,
        }) satisfies DialogSelectOption<string>,
    )

    return [...configured, ...missingDefaults]
  })

  const keybinds = createMemo(() => [
    {
      keybind: Keybind.parse("space")[0],
      title: "toggle",
      onTrigger: async (option: DialogSelectOption<string>) => {
        if (loading() !== null) return
        const entry = sync.data.config.connectors?.[option.value]
        if (!entry || !Connectors.isConnectorConfigured(entry)) {
          const preset = DEFAULT_CONNECTORS.find((item) => item.name === option.value)
          if (preset) {
            await openAuth(option.value, preset.type)
            return
          }
          return
        }
        setLoading(option.value)
        try {
          await local.connectors.toggle(option.value)
          await refreshStatus()
        } catch (error) {
          console.error("Failed to toggle connector:", error)
        } finally {
          setLoading(null)
        }
      },
    },
    {
      keybind: Keybind.parse("ctrl+a")[0],
      title: "auth",
      onTrigger: async (option: DialogSelectOption<string>) => {
        const preset = DEFAULT_CONNECTORS.find((item) => item.name === option.value)
        await openAuth(option.value, preset?.type)
      },
    },
    {
      keybind: Keybind.parse("x")[0],
      title: "logout",
      onTrigger: async (option: DialogSelectOption<string>) => {
        if (loading() !== null) return
        setLoading(option.value)
        try {
          await logout(option.value)
        } catch (error) {
          console.error("Failed to logout connector:", error)
        } finally {
          setLoading(null)
        }
      },
    },
    {
      keybind: Keybind.parse("ctrl+n")[0],
      title: "add",
      onTrigger: async () => {
        await addConnector()
      },
    },
  ])

  return (
    <DialogSelect
      title="Connectors"
      options={options()}
      keybind={keybinds()}
      onSelect={() => {
        // Don't close on select; align with MCP dialog behavior
      }}
    />
  )
}
