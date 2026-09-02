export const CONNECTOR_NAME = "discord"

// ViewChannel | SendMessages | AddReactions | EmbedLinks | AttachFiles |
// ReadMessageHistory | UseApplicationCommands | CreatePublicThreads | SendMessagesInThreads
const PERMISSION_BITS =
  (1n << 6n) | // AddReactions
  (1n << 10n) | // ViewChannel
  (1n << 11n) | // SendMessages
  (1n << 14n) | // EmbedLinks
  (1n << 15n) | // AttachFiles
  (1n << 16n) | // ReadMessageHistory
  (1n << 31n) | // UseApplicationCommands
  (1n << 35n) | // CreatePublicThreads
  (1n << 38n) // SendMessagesInThreads

export const INVITE_PERMISSIONS: string = PERMISSION_BITS.toString()

export function inviteUrl(clientId: string): string {
  return `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=${INVITE_PERMISSIONS}&scope=bot%20applications.commands`
}

export type DiscordUser = { id: string; username: string }

export async function lookupBotUser(botToken: string): Promise<DiscordUser> {
  const res = await fetch("https://discord.com/api/v10/users/@me", {
    headers: { Authorization: `Bot ${botToken}` },
  })
  if (res.status === 401) throw new Error("Invalid Discord bot token")
  if (!res.ok) throw new Error(`Discord API error ${res.status}`)
  const body = (await res.json()) as { id?: string; username?: string }
  if (!body.id || !body.username) throw new Error("Unexpected Discord user payload")
  return { id: body.id, username: body.username }
}
