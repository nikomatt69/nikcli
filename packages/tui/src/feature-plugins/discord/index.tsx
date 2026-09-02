/**
 * Discord Gateway bot — internal TUI plugin.
 *
 * Surfaces `@nikcli-ai/discord` through the generated HTTP client. Registers
 * `/discord` (alias `/discord-setup`): an unconfigured instance opens the
 * token wizard immediately; a configured one opens a manager for status,
 * start/stop, invite URL, and re-setup. No discord.js in this process.
 */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@nikcli-ai/plugin/tui"
import { Clipboard } from "@tui/util/clipboard"

const id = "internal:discord"

type DiscordStatus = {
  configured: boolean
  running: boolean
  username?: string
  clientId?: string
  inviteUrl?: string
  error?: string
}

type DiscordSetup = {
  username: string
  clientId: string
  inviteUrl: string
}

function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.length > 0) return error
  if (error && typeof error === "object") {
    if ("data" in error && error.data && typeof error.data === "object" && "message" in error.data) {
      const message = (error.data as { message: unknown }).message
      if (typeof message === "string" && message.length > 0) return message
    }
    if ("message" in error && typeof error.message === "string" && error.message.length > 0) {
      return error.message
    }
  }
  return fallback
}

async function loadStatus(api: TuiPluginApi): Promise<DiscordStatus | undefined> {
  const result = await api.client.discord.status()
  if (result.error) {
    api.ui.toast({
      message: errorMessage(result.error, "Failed to load Discord status"),
      variant: "error",
      duration: 5000,
    })
    return undefined
  }
  return result.data
}

async function setupToken(api: TuiPluginApi, botToken: string) {
  const result = await api.client.discord.setup({ botToken })
  if (result.error || !result.data) {
    return { error: errorMessage(result.error, "Could not verify the Discord bot token") }
  }
  return { data: result.data as DiscordSetup }
}

async function startBot(api: TuiPluginApi): Promise<void> {
  api.ui.toast({ message: "Starting Discord bot…", variant: "info" })
  const result = await api.client.discord.start()
  if (result.data?.running !== true) {
    api.ui.toast({
      message: result.data?.error ?? errorMessage(result.error, "Could not start the Discord bot"),
      variant: "error",
      duration: 5000,
    })
    return
  }
  api.ui.toast({ message: "Discord bot is running", variant: "success" })
  openManager(api)
}

async function stopBot(api: TuiPluginApi): Promise<void> {
  const result = await api.client.discord.stop()
  const stopped = result.data?.stopped === true
  api.ui.toast({
    message: stopped ? "Stopped Discord bot" : "Discord bot was not running",
    variant: stopped ? "success" : "warning",
  })
  openManager(api)
}

function copyInvite(api: TuiPluginApi, inviteUrl: string): void {
  void Clipboard.copy(inviteUrl)
    .then(() => {
      api.ui.toast({ message: "Invite URL copied", variant: "success" })
    })
    .catch(() => {
      api.ui.toast({ message: inviteUrl, variant: "info", duration: 8000 })
    })
}

function openStartChoice(api: TuiPluginApi): void {
  const Select = api.ui.DialogSelect
  api.ui.dialog.replace(() => (
    <Select
      title="Start Discord bot"
      options={[
        {
          title: "Start now",
          value: "start",
          description: "Connect the Gateway and listen for mentions",
          onSelect() {
            void startBot(api).catch((error) => {
              api.ui.toast({
                message: error instanceof Error ? error.message : "Failed to start Discord bot",
                variant: "error",
                duration: 5000,
              })
            })
          },
        },
        {
          title: "Later",
          value: "later",
          description: "Start from /discord when you are ready",
          onSelect() {
            api.ui.dialog.clear()
          },
        },
      ]}
    />
  ))
}

function showConnected(api: TuiPluginApi, setup: DiscordSetup): void {
  const Alert = api.ui.DialogAlert
  api.ui.dialog.replace(() => (
    <Alert
      title={`Connected as ${setup.username}`}
      message={`Invite URL:\n${setup.inviteUrl}\n\nEnable Message Content Intent, then open the invite link.`}
      onConfirm={() => openStartChoice(api)}
    />
  ))
}

function openWizard(api: TuiPluginApi): void {
  const Prompt = api.ui.DialogPrompt
  api.ui.dialog.replace(() => (
    <Prompt
      title="Paste the Discord bot token"
      placeholder="Bot token"
      description={() => (
        <text fg={api.theme.current.foreground.muted}>
          Discord Developer Portal → your app → Bot → Reset Token. Enable Message Content Intent before inviting the
          bot.
        </text>
      )}
      onConfirm={(raw) => {
        const botToken = raw.trim()
        if (!botToken) {
          api.ui.toast({ message: "Bot token is required", variant: "error" })
          return
        }
        api.ui.toast({ message: "Checking token…", variant: "info" })
        void (async () => {
          const result = await setupToken(api, botToken)
          if ("error" in result) {
            api.ui.toast({ message: result.error ?? "Discord setup failed", variant: "error", duration: 5000 })
            openWizard(api)
            return
          }
          showConnected(api, result.data)
        })().catch((error) => {
          api.ui.toast({
            message: error instanceof Error ? error.message : "Discord setup failed",
            variant: "error",
            duration: 5000,
          })
          openWizard(api)
        })
      }}
    />
  ))
}

function showStatus(api: TuiPluginApi, status: DiscordStatus): void {
  const Alert = api.ui.DialogAlert
  const lines = [`Configured: ${status.configured ? "yes" : "no"}`, `Running: ${status.running ? "yes" : "no"}`]
  if (status.username) lines.push(`Username: ${status.username}`)
  if (status.clientId) lines.push(`Client ID: ${status.clientId}`)
  if (status.inviteUrl) lines.push(`Invite URL: ${status.inviteUrl}`)
  if (status.error) lines.push(`Error: ${status.error}`)
  api.ui.dialog.replace(() => (
    <Alert title="Discord bot" message={lines.join("\n")} onConfirm={() => openManager(api)} />
  ))
}

function showInvite(api: TuiPluginApi, status: DiscordStatus): void {
  const inviteUrl = status.inviteUrl
  if (!inviteUrl) {
    api.ui.toast({
      message: "Invite URL is not available yet. Re-setup the bot to generate one.",
      variant: "warning",
      duration: 5000,
    })
    openManager(api)
    return
  }
  copyInvite(api, inviteUrl)
  const Alert = api.ui.DialogAlert
  api.ui.dialog.replace(() => (
    <Alert
      title="Discord invite URL"
      message={`${inviteUrl}\n\nEnable Message Content Intent, then open the invite link.`}
      onConfirm={() => openManager(api)}
    />
  ))
}

export function openManager(api: TuiPluginApi): void {
  void (async () => {
    const status = await loadStatus(api)
    if (!status) return
    if (!status.configured) {
      openWizard(api)
      return
    }
    const Select = api.ui.DialogSelect
    const title = status.username
      ? `Discord bot · ${status.username} · ${status.running ? "running" : "stopped"}`
      : `Discord bot · ${status.running ? "running" : "stopped"}`
    api.ui.dialog.replace(() => (
      <Select
        title={title}
        options={[
          {
            title: "Status",
            value: "status",
            description: status.running ? "Gateway is connected" : "Gateway is stopped",
            onSelect() {
              showStatus(api, status)
            },
          },
          status.running
            ? {
                title: "Stop bot",
                value: "stop",
                description: "Disconnect the Discord Gateway",
                onSelect() {
                  void stopBot(api).catch((error) => {
                    api.ui.toast({
                      message: error instanceof Error ? error.message : "Failed to stop Discord bot",
                      variant: "error",
                      duration: 5000,
                    })
                  })
                },
              }
            : {
                title: "Start bot",
                value: "start",
                description: "Connect the Gateway and listen for mentions",
                onSelect() {
                  void startBot(api).catch((error) => {
                    api.ui.toast({
                      message: error instanceof Error ? error.message : "Failed to start Discord bot",
                      variant: "error",
                      duration: 5000,
                    })
                  })
                },
              },
          {
            title: "Show invite URL",
            value: "invite",
            description: status.inviteUrl ?? "Generate an invite after setup",
            onSelect() {
              showInvite(api, status)
            },
          },
          {
            title: "Re-setup",
            value: "setup",
            description: "Paste a new bot token",
            onSelect() {
              openWizard(api)
            },
          },
        ]}
      />
    ))
  })().catch((error) => {
    api.ui.toast({
      message: error instanceof Error ? error.message : "Failed to load Discord bot",
      variant: "error",
      duration: 5000,
    })
  })
}

const tui: TuiPlugin = async (api) => {
  api.keymap.registerLayer({
    commands: [
      {
        name: "discord.setup",
        title: "Discord bot",
        namespace: "Integrations",
        description: "Set up and manage the Discord Gateway bot",
        slashName: "discord",
        slashAliases: ["discord-setup"],
        run() {
          openManager(api)
        },
      },
    ],
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
