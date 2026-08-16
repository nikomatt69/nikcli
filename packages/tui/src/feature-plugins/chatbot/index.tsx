/**
 * Chat bots — internal TUI plugin.
 *
 * Mirrors `feature-plugins/loops`: surfaces the Chat SDK bots (see
 * `src/chatbot/`) in the TUI as a self-contained plugin. Registers the
 * `/bots` slash command (alias: `/chatbot`) that opens a manager listing
 * every chat-platform connector (Discord, Slack, Teams, Google Chat, Linear,
 * GitHub) with its running state, and offers start/stop plus the webhook
 * path each platform must be pointed at.
 */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@nikcli-ai/plugin/tui"

const id = "internal:chatbot"

/**
 * Which bots exist and which are up.
 *
 * Both halves come from the server now. The running set was never derivable
 * from the synced config — only the process that owns the bots knows — so the
 * join belongs on the side that has both.
 */
type BotEntry = {
  name: string
  type: string
  running: boolean
  webhookPath: string
}

async function loadBots(api: TuiPluginApi): Promise<BotEntry[]> {
  const result = await api.client.chatbot.bots()
  return [...(result.data ?? [])]
}

function openBot(api: TuiPluginApi, entry: BotEntry): void {
  const Select = api.ui.DialogSelect
  api.ui.dialog.replace(() => (
    <Select
      title={`${entry.name} · ${entry.type} · ${entry.running ? "running" : "stopped"}`}
      options={[
        entry.running
          ? {
              title: "Stop bot",
              value: "stop",
              description: "Disconnect the bot from its platform",
              onSelect() {
                void (async () => {
                  const result = await api.client.chatbot.stop({ name: entry.name })
                  const removed = result.data?.removed === true
                  api.ui.toast({
                    message: removed ? `Stopped bot ${entry.name}` : `Bot ${entry.name} was not running`,
                    variant: removed ? "success" : "warning",
                  })
                  openManager(api)
                })()
              },
            }
          : {
              title: "Start bot",
              value: "start",
              description: "Create the bot and register the AI mention handler",
              onSelect() {
                api.ui.toast({ message: `Starting bot ${entry.name}…`, variant: "info" })
                void (async () => {
                  // The instance the request lands on is the one bound by the
                  // directory header, so no `withInstanceAsync` here.
                  const result = await api.client.chatbot.start({ name: entry.name })
                  if (result.data?.running !== true) {
                    api.ui.toast({
                      message:
                        result.data?.error ?? `Could not start ${entry.name} — check credentials (nikcli bot auth)`,
                      variant: "error",
                      duration: 5000,
                    })
                    return
                  }
                  api.ui.toast({ message: `Bot ${entry.name} is running`, variant: "success" })
                  openManager(api)
                })().catch((error) => {
                  api.ui.toast({
                    message: error instanceof Error ? error.message : "Failed to start bot",
                    variant: "error",
                    duration: 5000,
                  })
                })
              },
            },
        {
          title: "Webhook path",
          value: "webhook",
          description: entry.webhookPath,
          onSelect() {
            const Alert = api.ui.DialogAlert
            api.ui.dialog.replace(() => (
              <Alert
                title={`Webhook — ${entry.name}`}
                message={`Point the ${entry.type} platform at:\n${entry.webhookPath}`}
              />
            ))
          },
        },
        {
          title: "Back",
          value: "back",
          onSelect() {
            openManager(api)
          },
        },
      ]}
    />
  ))
}

export function openManager(api: TuiPluginApi): void {
  void (async () => {
    const entries = await loadBots(api)
    if (entries.length === 0) {
      const Alert = api.ui.DialogAlert
      api.ui.dialog.replace(() => (
        <Alert title="Chat Bots" message={"No chat bots configured.\nAdd one with: nikcli bot add"} />
      ))
      return
    }
    const Select = api.ui.DialogSelect
    api.ui.dialog.replace(() => (
      <Select
        title="Chat Bots"
        options={entries.map((entry) => ({
          title: `${entry.running ? "●" : "○"} ${entry.name}`,
          value: entry.name,
          description: `${entry.type} · ${entry.running ? "running" : "stopped"}`,
          onSelect() {
            openBot(api, entry)
          },
        }))}
      />
    ))
  })().catch((error) => {
    api.ui.toast({
      message: error instanceof Error ? error.message : "Failed to load chat bots",
      variant: "error",
      duration: 5000,
    })
  })
}

const tui: TuiPlugin = async (api) => {
  api.keymap.registerLayer({
    commands: [
      {
        name: "chatbot.manage",
        title: "Chat Bots",
        namespace: "System",
        description: "Manage Chat SDK bots (Discord, Slack, Teams, …)",
        slashName: "bots",
        slashAliases: ["chatbot"],
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
