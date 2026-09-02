/**
 * Registers the global `/nikcli` slash command used by the Cloudflare
 * Interactions Worker (`src/worker.ts`).
 *
 * The Gateway bot registers its own commands on ready; the Worker cannot,
 * because it only ever runs in response to an interaction that already exists.
 * So this is a one-off script:
 *
 *   DISCORD_BOT_TOKEN=... bun run register
 *
 * Global commands can take up to an hour to propagate. Pass DISCORD_GUILD_ID to
 * register into a single guild instead — those appear immediately, which is
 * what you want while testing.
 */

const DISCORD_API = "https://discord.com/api/v10"

const token = process.env.DISCORD_BOT_TOKEN?.trim()
if (!token) {
  console.error("DISCORD_BOT_TOKEN is required (Developer Portal → Bot → Reset Token)")
  process.exit(1)
}

const guildId = process.env.DISCORD_GUILD_ID?.trim()

const applicationId = process.env.DISCORD_APPLICATION_ID?.trim() || (await lookupApplicationId(token))
if (!applicationId) {
  console.error("Couldn't resolve the application id; set DISCORD_APPLICATION_ID")
  process.exit(1)
}

const commands = [
  {
    name: "nikcli",
    description: "Ask nikcli to work on something",
    options: [
      {
        name: "prompt",
        description: "What should nikcli do?",
        type: 3, // STRING
        required: true,
      },
    ],
  },
]

const url = guildId
  ? `${DISCORD_API}/applications/${applicationId}/guilds/${guildId}/commands`
  : `${DISCORD_API}/applications/${applicationId}/commands`

const response = await fetch(url, {
  method: "PUT",
  headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(commands),
})

if (!response.ok) {
  console.error(`Failed to register commands (${response.status}):`, await response.text())
  process.exit(1)
}

console.log(guildId ? `Registered /nikcli in guild ${guildId}` : "Registered /nikcli globally (up to 1h to appear)")

async function lookupApplicationId(botToken: string): Promise<string | null> {
  const response = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bot ${botToken}` },
  })
  if (!response.ok) return null
  const user = (await response.json()) as { id?: string }
  return user.id ?? null
}
