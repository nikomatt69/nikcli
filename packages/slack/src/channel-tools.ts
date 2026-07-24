import os from "os"
import path from "path"
import { JsonStore } from "./persist"

// Per-channel tool policy. An admin decides which nikcli tools the bot may use
// in each channel (the "tools and access an admin set up for that channel" part
// of Claude Tag). The resulting allow/deny map is passed to body.tools on every
// prompt.

export namespace ChannelTools {
  type Policy = {
    // tool name -> enabled. Absent tools fall back to the server default.
    tools: Record<string, boolean>
    updatedAt: number
  }

  const FILE = process.env.CHANNEL_TOOLS_FILE ?? path.join(os.tmpdir(), "slack-channel-tools.json")
  const store = new JsonStore<Policy>(FILE)

  // Workspace-wide default, e.g. SLACK_DEFAULT_TOOLS="bash=false,write=false,edit=false"
  const defaults = parseToolSpec(process.env.SLACK_DEFAULT_TOOLS ?? "")

  const adminUsers = new Set((process.env.SLACK_ADMIN_USERS ?? "").split(/[\s,]+/).filter(Boolean))

  export async function init(): Promise<void> {
    await store.load()
  }

  export function keyOf(team: string | undefined, channel: string): string {
    return `${team || "default"}:${channel}`
  }

  export function isAdmin(userId: string | undefined): boolean {
    // If no admin list is configured, anyone may manage policy (single-team use).
    if (adminUsers.size === 0) return true
    return !!userId && adminUsers.has(userId)
  }

  /** Effective tool map for a channel: workspace defaults overlaid with channel overrides. */
  export function toolsFor(key: string): Record<string, boolean> | undefined {
    const channel = store.get(key)?.tools
    const merged = { ...defaults, ...(channel ?? {}) }
    return Object.keys(merged).length ? merged : undefined
  }

  function set(key: string, tool: string, enabled: boolean): void {
    const entry = store.get(key) ?? { tools: {}, updatedAt: Date.now() }
    entry.tools[tool] = enabled
    entry.updatedAt = Date.now()
    store.set(key, entry)
  }

  function reset(key: string): void {
    store.delete(key)
  }

  function parseToolSpec(spec: string): Record<string, boolean> {
    const out: Record<string, boolean> = {}
    for (const part of spec.split(/[\s,]+/).filter(Boolean)) {
      const [name, value] = part.split("=")
      if (!name) continue
      out[name] = value !== "false" && value !== "0"
    }
    return out
  }

  /**
   * Handle the `/nikcli-tools` slash command body. Returns the text to reply with.
   * Subcommands: (empty)/list, allow <tool>, deny <tool>, reset.
   */
  export function handleCommand(rawText: string, key: string, userId: string | undefined): string {
    if (!isAdmin(userId)) {
      return "⛔ Only an admin can manage tool policy for this channel."
    }

    const [sub, ...rest] = rawText.trim().split(/\s+/).filter(Boolean)
    const arg = rest.join(" ")

    switch ((sub ?? "list").toLowerCase()) {
      case "allow":
      case "enable": {
        if (!arg) return "Usage: `/nikcli-tools allow <tool>`"
        set(key, arg, true)
        return `✅ Enabled *${arg}* in this channel.\n${describe(key)}`
      }
      case "deny":
      case "disable": {
        if (!arg) return "Usage: `/nikcli-tools deny <tool>`"
        set(key, arg, false)
        return `🚫 Disabled *${arg}* in this channel.\n${describe(key)}`
      }
      case "reset":
        reset(key)
        return `♻️ Reset tool policy for this channel to workspace defaults.\n${describe(key)}`
      case "list":
      case "show":
        return describe(key)
      default:
        return "Commands: `list`, `allow <tool>`, `deny <tool>`, `reset`"
    }
  }

  export function describe(key: string): string {
    const effective = toolsFor(key)
    if (!effective) return "No tool restrictions in this channel — all server-default tools are available."
    const lines = Object.entries(effective)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([tool, enabled]) => `${enabled ? "✅" : "🚫"} ${tool}`)
    return `*Tool policy for this channel:*\n${lines.join("\n")}`
  }

  export async function flush(): Promise<void> {
    await store.flush()
  }
}
