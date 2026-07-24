import os from "os"
import path from "path"
import { JsonStore } from "./persist"

// Per-channel memory: the bot remembers salient requests made in each channel
// (across threads) and injects them as context on every new session, so it
// builds up shared context the way Claude Tag does for the channels it's in.

export namespace ChannelMemory {
  type Entry = {
    // Most recent salient user requests in this channel, newest last.
    messages: string[]
    // Optional human/admin-curated summary of what this channel is about.
    summary?: string
    updatedAt: number
  }

  const enabled = process.env.SLACK_CHANNEL_MEMORY !== "false" && process.env.NIKCLI_SLACK_CHANNEL_MEMORY !== "false"
  const MAX_MESSAGES = Math.max(1, Number(process.env.SLACK_CHANNEL_MEMORY_SIZE ?? "12"))
  const MAX_LEN = 280
  const FILE = process.env.CHANNEL_MEMORY_FILE ?? path.join(os.tmpdir(), "slack-channel-memory.json")

  const store = new JsonStore<Entry>(FILE)

  export async function init(): Promise<void> {
    if (!enabled) return
    await store.load()
  }

  export function keyOf(team: string | undefined, channel: string): string {
    return `${team || "default"}:${channel}`
  }

  /** Context block injected into body.system when (re)starting a channel session. */
  export function systemPreamble(key: string): string | undefined {
    if (!enabled) return undefined
    const entry = store.get(key)
    if (!entry) return undefined

    const lines: string[] = []
    if (entry.summary) lines.push(`What this channel is about: ${entry.summary}`)
    if (entry.messages.length) {
      lines.push("Recent things people asked you in this channel (newest last):")
      for (const m of entry.messages) lines.push(`- ${m}`)
    }
    if (!lines.length) return undefined
    return [
      "## Channel memory",
      "Background context from this Slack channel. Use it only when relevant; don't repeat it verbatim.",
      ...lines,
    ].join("\n")
  }

  /** Record a user request so future sessions in this channel remember it. */
  export function record(key: string, userText: string): void {
    if (!enabled) return
    const text = userText.trim().replace(/\s+/g, " ").slice(0, MAX_LEN)
    if (!text) return

    const entry = store.get(key) ?? { messages: [], updatedAt: Date.now() }
    // Drop a duplicate of the same request, then append as newest.
    entry.messages = entry.messages.filter((m) => m !== text)
    entry.messages.push(text)
    if (entry.messages.length > MAX_MESSAGES) entry.messages = entry.messages.slice(-MAX_MESSAGES)
    entry.updatedAt = Date.now()
    store.set(key, entry)
  }

  /** Admin-set one-line summary of the channel's purpose. */
  export function setSummary(key: string, summary: string): void {
    if (!enabled) return
    const entry = store.get(key) ?? { messages: [], updatedAt: Date.now() }
    entry.summary = summary.trim().slice(0, MAX_LEN) || undefined
    entry.updatedAt = Date.now()
    store.set(key, entry)
  }

  export function clear(key: string): boolean {
    return store.delete(key)
  }

  export async function flush(): Promise<void> {
    if (!enabled) return
    await store.flush()
  }
}
