export type CatalogPlugin = {
  pkg: string
  name: string
  description: string
}

export const PLUGIN_CATALOG: CatalogPlugin[] = [
  { pkg: "opencode-notify",            name: "Notify",            description: "OS notifications when tasks complete" },
  { pkg: "opencode-background-agents", name: "Background Agents", description: "Claude Code-style background agents with async delegation" },
  { pkg: "opencode-agent-memory",      name: "Agent Memory",      description: "Persistent self-editable memory blocks (Letta-inspired)" },
  { pkg: "opencode-smart-title",       name: "Smart Title",       description: "Auto-generates meaningful session titles with AI" },
  { pkg: "opencode-quota",             name: "Quota",             description: "Track quota and token usage across providers" },
  { pkg: "opencode-worktree",          name: "Worktree",          description: "Zero-friction git worktrees with auto-spawned terminals" },
  { pkg: "opencode-synced",            name: "Synced",            description: "Sync global opencode config across machines" },
  { pkg: "opencode-direnv",            name: "Direnv",            description: "Auto-load direnv env vars at session start (Nix-friendly)" },
  { pkg: "opencode-handoff",           name: "Handoff",           description: "Creates focused handoff prompts for new sessions" },
  { pkg: "opencode-snip",              name: "Snip",              description: "Reduce LLM token consumption by 60–90% via shell command prefix" },
]
