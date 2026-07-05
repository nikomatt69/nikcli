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
import type { Config } from "@/config/config"
import { withInstanceAsync } from "@/effect"

const id = "internal:chatbot"

type BotEntry = {
  name: string
  type: string
  config: Config.Connector
  running: boolean
  webhookPath: string
}

async function loadBots(api: TuiPluginApi): Promise<BotEntry[]> {
  const { ChatBot } = await import("@/chatbot")
  const configured = (api.state.config.connectors ?? {}) as Record<string, unknown>
  const running = ChatBot.getAllBots()
  const entries: BotEntry[] = []
  for (const [name, raw] of Object.entries(configured)) {
    if (typeof raw !== "object" || raw === null) continue
    const config = raw as Config.Connector
    if (typeof config.type !== "string" || !ChatBot.isChatPlatform(config.type)) continue
    entries.push({
      name,
      type: config.type,
      config,
      running: running.has(name),
      webhookPath: ChatBot.getWebhookPath(config.type, name),
    })
  }
  return entries
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
                  const { ChatBot } = await import("@/chatbot")
                  const removed = ChatBot.removeBot(entry.name)
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
                  const directory = api.state.path.directory || process.cwd()
                  const { BotHandlers } = await import("@/chatbot/handlers")
                  const bot = await withInstanceAsync({ directory }, () =>
                    BotHandlers.ensureAiBot(entry.name, entry.config),
                  )
                  if (!bot) {
                    api.ui.toast({
                      message: `Could not start ${entry.name} — check credentials (nikcli bot auth)`,
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
